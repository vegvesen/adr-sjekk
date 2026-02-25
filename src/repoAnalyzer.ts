import * as vscode from 'vscode';
import { ADR } from './confluenceClient';

/**
 * Resultat av en ADR-sjekk mot repoet.
 */
export interface ADRCheckResult {
    adr: ADR;
    /** Samsvar-status: compliant, non-compliant, needs-review, not-applicable */
    status: 'compliant' | 'non-compliant' | 'needs-review' | 'not-applicable';
    /** Forklaring av resultatet */
    summary: string;
    /** Eventuelle funn / detaljer */
    details: string[];
    /** Relevante filer som ble sjekket */
    relevantFiles: string[];
}

/**
 * Samler informasjon om repoets struktur og innhold for analyse.
 */
export class RepoAnalyzer {

    /**
     * Samler en oversikt over repoet: filstruktur, konfigurasjonsfiler, osv.
     */
    public async gatherRepoContext(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return 'Ingen workspace-mappe er åpen.';
        }

        const rootUri = workspaceFolders[0].uri;
        const sections: string[] = [];

        // 1. Filstruktur (topp-nivå + viktige undermapper)
        sections.push('## Filstruktur (topp-nivå)');
        const topLevelFiles = await this.listDirectory(rootUri);
        sections.push(topLevelFiles.join('\n'));

        // 2. Konfigrasjonsfiler
        sections.push('\n## Konfigurasjonsfiler funnet');
        const configFiles = await this.findConfigFiles(rootUri);
        for (const cf of configFiles) {
            sections.push(`\n### ${cf.path}`);
            sections.push(cf.content);
        }

        // 3. README
        sections.push('\n## README-innhold');
        const readme = await this.readFileIfExists(rootUri, 'README.md');
        if (readme) {
            sections.push(readme.substring(0, 3000)); // Begrens størrelse
        } else {
            sections.push('Ingen README.md funnet.');
        }

        // 4. Docker-konfigurasjon
        const dockerfile = await this.readFileIfExists(rootUri, 'Dockerfile');
        if (dockerfile) {
            sections.push('\n## Dockerfile');
            sections.push(dockerfile.substring(0, 2000));
        }

        const dockerCompose = await this.readFileIfExists(rootUri, 'docker-compose.yml')
            || await this.readFileIfExists(rootUri, 'docker-compose.yaml');
        if (dockerCompose) {
            sections.push('\n## docker-compose.yml');
            sections.push(dockerCompose.substring(0, 2000));
        }

        // 5. CI/CD-konfigurasjon
        sections.push('\n## CI/CD-konfigurasjon');
        const ciFiles = await this.findCIFiles(rootUri);
        for (const ci of ciFiles) {
            sections.push(`\n### ${ci.path}`);
            sections.push(ci.content.substring(0, 2000));
        }

        // 6. Teknologi-deteksjon
        sections.push('\n## Detekterte teknologier');
        const techs = await this.detectTechnologies(rootUri);
        sections.push(techs.join(', '));

        // 7. Avhengigheter
        sections.push('\n## Avhengigheter');
        const deps = await this.gatherDependencies(rootUri);
        sections.push(deps);

        // 8. Testoppsett
        sections.push('\n## Test-konfigurasjon');
        const testInfo = await this.gatherTestInfo(rootUri);
        sections.push(testInfo);

        return sections.join('\n');
    }

    private async listDirectory(uri: vscode.Uri): Promise<string[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries.map(([name, type]) => {
                const icon = type === vscode.FileType.Directory ? '📁' : '📄';
                return `${icon} ${name}`;
            });
        } catch {
            return ['Kunne ikke lese mappeinnhold.'];
        }
    }

    private async readFileIfExists(rootUri: vscode.Uri, relativePath: string): Promise<string | null> {
        try {
            const fileUri = vscode.Uri.joinPath(rootUri, relativePath);
            const content = await vscode.workspace.fs.readFile(fileUri);
            return Buffer.from(content).toString('utf-8');
        } catch {
            return null;
        }
    }

    private async findConfigFiles(rootUri: vscode.Uri): Promise<{ path: string; content: string }[]> {
        const configPatterns = [
            'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
            'settings.gradle', 'settings.gradle.kts',
            '.eslintrc.json', '.eslintrc.js', '.eslintrc.yml',
            'tsconfig.json', 'angular.json', 'next.config.js', 'next.config.mjs',
            'vite.config.ts', 'vite.config.js', 'webpack.config.js',
            'application.yml', 'application.yaml', 'application.properties',
            '.env.example', '.editorconfig', '.prettierrc', '.prettierrc.json',
            'sonar-project.properties', 'Makefile', 'Cargo.toml',
            'pyproject.toml', 'setup.py', 'requirements.txt',
            'go.mod', 'go.sum'
        ];

        const results: { path: string; content: string }[] = [];
        for (const pattern of configPatterns) {
            const content = await this.readFileIfExists(rootUri, pattern);
            if (content) {
                results.push({ path: pattern, content: content.substring(0, 3000) });
            }
        }
        return results;
    }

    private async findCIFiles(rootUri: vscode.Uri): Promise<{ path: string; content: string }[]> {
        const ciPaths = [
            '.github/workflows',
            '.gitlab-ci.yml',
            'Jenkinsfile',
            'azure-pipelines.yml',
            '.circleci/config.yml'
        ];

        const results: { path: string; content: string }[] = [];

        // GitHub Actions
        try {
            const ghDir = vscode.Uri.joinPath(rootUri, '.github', 'workflows');
            const entries = await vscode.workspace.fs.readDirectory(ghDir);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && (name.endsWith('.yml') || name.endsWith('.yaml'))) {
                    const content = await this.readFileIfExists(rootUri, `.github/workflows/${name}`);
                    if (content) {
                        results.push({ path: `.github/workflows/${name}`, content });
                    }
                }
            }
        } catch { /* ignore */ }

        // Andre CI-filer
        for (const p of ciPaths.slice(1)) {
            const content = await this.readFileIfExists(rootUri, p);
            if (content) {
                results.push({ path: p, content });
            }
        }

        return results;
    }

    private async detectTechnologies(rootUri: vscode.Uri): Promise<string[]> {
        const techs: string[] = [];

        const checks: { file: string; tech: string }[] = [
            { file: 'package.json', tech: 'Node.js/JavaScript' },
            { file: 'tsconfig.json', tech: 'TypeScript' },
            { file: 'pom.xml', tech: 'Java/Maven' },
            { file: 'build.gradle', tech: 'Java/Gradle' },
            { file: 'build.gradle.kts', tech: 'Kotlin/Gradle' },
            { file: 'go.mod', tech: 'Go' },
            { file: 'Cargo.toml', tech: 'Rust' },
            { file: 'pyproject.toml', tech: 'Python' },
            { file: 'requirements.txt', tech: 'Python' },
            { file: 'setup.py', tech: 'Python' },
            { file: 'Gemfile', tech: 'Ruby' },
            { file: 'Dockerfile', tech: 'Docker' },
            { file: 'docker-compose.yml', tech: 'Docker Compose' },
            { file: 'docker-compose.yaml', tech: 'Docker Compose' },
            { file: 'terraform.tf', tech: 'Terraform' },
            { file: 'angular.json', tech: 'Angular' },
            { file: 'next.config.js', tech: 'Next.js' },
            { file: 'next.config.mjs', tech: 'Next.js' },
            { file: 'nuxt.config.ts', tech: 'Nuxt.js' },
            { file: 'vite.config.ts', tech: 'Vite' },
        ];

        for (const check of checks) {
            try {
                const fileUri = vscode.Uri.joinPath(rootUri, check.file);
                await vscode.workspace.fs.stat(fileUri);
                if (!techs.includes(check.tech)) {
                    techs.push(check.tech);
                }
            } catch { /* ignore */ }
        }

        return techs.length > 0 ? techs : ['Ingen kjente teknologier detektert'];
    }

    private async gatherDependencies(rootUri: vscode.Uri): Promise<string> {
        const parts: string[] = [];

        // package.json dependencies
        const pkgJson = await this.readFileIfExists(rootUri, 'package.json');
        if (pkgJson) {
            try {
                const pkg = JSON.parse(pkgJson);
                if (pkg.dependencies) {
                    parts.push('### npm dependencies');
                    parts.push(Object.keys(pkg.dependencies).join(', '));
                }
                if (pkg.devDependencies) {
                    parts.push('### npm devDependencies');
                    parts.push(Object.keys(pkg.devDependencies).join(', '));
                }
            } catch { /* ignore */ }
        }

        // pom.xml (bare nevn at den finnes)
        const pom = await this.readFileIfExists(rootUri, 'pom.xml');
        if (pom) {
            parts.push('### Maven (pom.xml)');
            // Ekstraher artifact IDs
            const artifactIds = [...pom.matchAll(/<artifactId>(.*?)<\/artifactId>/g)];
            parts.push(artifactIds.map(m => m[1]).join(', '));
        }

        return parts.length > 0 ? parts.join('\n') : 'Ingen avhengighetsfiler funnet.';
    }

    private async gatherTestInfo(rootUri: vscode.Uri): Promise<string> {
        const parts: string[] = [];

        // Sjekk vanlige test-mapper
        const testDirs = ['test', 'tests', 'src/test', '__tests__', 'spec', 'src/__tests__'];
        for (const dir of testDirs) {
            try {
                const dirUri = vscode.Uri.joinPath(rootUri, dir);
                await vscode.workspace.fs.stat(dirUri);
                parts.push(`Testmappe funnet: ${dir}/`);
            } catch { /* ignore */ }
        }

        // Sjekk test-rammeverk i package.json
        const pkgJson = await this.readFileIfExists(rootUri, 'package.json');
        if (pkgJson) {
            try {
                const pkg = JSON.parse(pkgJson);
                const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
                const testFrameworks = ['jest', 'mocha', 'vitest', 'cypress', 'playwright', 'jasmine', 'karma', 'ava', 'tap'];
                for (const fw of testFrameworks) {
                    if (allDeps[fw]) {
                        parts.push(`Test-rammeverk: ${fw}`);
                    }
                }
                if (pkg.scripts?.test) {
                    parts.push(`Test-script: ${pkg.scripts.test}`);
                }
            } catch { /* ignore */ }
        }

        return parts.length > 0 ? parts.join('\n') : 'Ingen test-konfigurasjon funnet.';
    }
}
