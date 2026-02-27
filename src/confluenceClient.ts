import * as vscode from 'vscode';
import * as cheerio from 'cheerio';

/**
 * Representerer en ADR (Architecture Decision Record) hentet fra Confluence.
 */
export interface ADR {
    /** Confluence page ID */
    id: string;
    /** Tittel på ADR-en */
    title: string;
    /** HTML-innhold fra Confluence */
    htmlBody: string;
    /** Ren tekst (stripet for HTML-tagger) */
    plainText: string;
    /** URL til Confluence-siden */
    url: string;
    /** Status (f.eks. Akseptert, Foreslått, Avvist) */
    status: string;
}

/**
 * Confluence REST API-klient for å hente ADR-er.
 * Bruker PAT (Personal Access Token) for autentisering.
 */
export class ConfluenceClient {
    private baseUrl: string;
    private pat: string;
    private pageId: string;
    private spaceKey: string;

    constructor(pat: string) {
        const config = vscode.workspace.getConfiguration('adr-sjekk');
        this.baseUrl = (config.get<string>('confluenceBaseUrl', '') || '').replace(/\/+$/, '');
        this.pat = pat;
        this.pageId = config.get<string>('confluencePageId', '12345678');
        this.spaceKey = config.get<string>('confluenceSpaceKey', 'XX');
    }

    /**
     * Sjekker at PAT og base-URL er konfigurert, og at HTTPS brukes.
     */
    public validateConfig(): string | undefined {
        if (!this.baseUrl) {
            return 'Confluence base-URL er ikke konfigurert. Sett `adr-sjekk.confluenceBaseUrl` i VS Code-innstillingene.';
        }
        if (!this.baseUrl.startsWith('https://')) {
            return 'Confluence base-URL må bruke HTTPS for sikker kommunikasjon. Endre `adr-sjekk.confluenceBaseUrl` til å starte med `https://`.';
        }
        if (!this.pat) {
            return 'Confluence PAT er ikke konfigurert. Kjør `@adr-sjekk /settPAT` for å lagre token sikkert i SecretStorage.';
        }
        return undefined;
    }

    /**
     * Henter hovedsiden (ADR-oversikt) fra Confluence.
     */
    public async getMainPage(): Promise<{ title: string; body: string; childPageIds: string[] }> {
        const url = `${this.baseUrl}/rest/api/content/${this.pageId}?expand=body.storage,children.page`;
        const response = await this.fetchFromConfluence(url);

        const childPages = response.children?.page?.results || [];
        const childPageIds = childPages.map((p: any) => p.id);

        return {
            title: response.title,
            body: response.body?.storage?.value || '',
            childPageIds
        };
    }

    /**
     * Henter alle child pages (ADR-er) under hovedsiden.
     */
    public async getChildPages(limit: number = 50): Promise<any[]> {
        const url = `${this.baseUrl}/rest/api/content/${this.pageId}/child/page?limit=${limit}&expand=body.storage`;
        const response = await this.fetchFromConfluence(url);
        return response.results || [];
    }

    /**
     * Henter en enkelt side fra Confluence.
     */
    public async getPage(pageId: string): Promise<any> {
        const url = `${this.baseUrl}/rest/api/content/${pageId}?expand=body.storage`;
        return await this.fetchFromConfluence(url);
    }

    /**
     * Henter og parser alle ADR-er fra Confluence.
     * Prøver først child pages, deretter parser hovedsiden for lenker.
     */
    public async fetchAllADRs(): Promise<ADR[]> {
        const adrs: ADR[] = [];

        // Strategi 1: Hent child pages
        try {
            const childPages = await this.getChildPages();
            if (childPages.length > 0) {
                for (const page of childPages) {
                    const adr = this.pageToADR(page);
                    if (adr) {
                        adrs.push(adr);
                    }
                }
            }
        } catch (e) {
            // Child pages feilet, prøv strategi 2
        }

        // Strategi 2: Hent hovedsiden og parse lenker til ADR-er
        if (adrs.length === 0) {
            const mainPage = await this.getMainPage();
            const linkedPageIds = this.extractLinkedPageIds(mainPage.body);

            for (const pid of linkedPageIds) {
                try {
                    const page = await this.getPage(pid);
                    const adr = this.pageToADR(page);
                    if (adr) {
                        adrs.push(adr);
                    }
                } catch (e) {
                    // Ignorer sider som ikke kan hentes
                }
            }
        }

        // Strategi 3: Parse ADR-er direkte fra hovedsidens innhold
        if (adrs.length === 0) {
            const mainPage = await this.getMainPage();
            const inlineAdrs = this.parseInlineADRs(mainPage.body, mainPage.title);
            adrs.push(...inlineAdrs);
        }

        return adrs;
    }

    /**
     * Konverterer en Confluence-side til en ADR.
     */
    private pageToADR(page: any): ADR | null {
        if (!page || !page.title) {
            return null;
        }

        const htmlBody = page.body?.storage?.value || '';
        const plainText = this.stripHtml(htmlBody);
        const status = this.extractStatus(htmlBody, plainText);

        return {
            id: page.id,
            title: page.title,
            htmlBody,
            plainText,
            url: `${this.baseUrl}${page._links?.webui || `/pages/viewpage.action?pageId=${page.id}`}`,
            status
        };
    }

    /**
     * Ekstraher page IDs fra lenker i HTML-innhold.
     */
    private extractLinkedPageIds(html: string): string[] {
        const ids: string[] = [];
        // Match Confluence interne lenker: ri:content-id="12345"
        const contentIdRegex = /ri:content-id="(\d+)"/g;
        let match;
        while ((match = contentIdRegex.exec(html)) !== null) {
            ids.push(match[1]);
        }

        // Match pageId-lenker i href
        const pageIdRegex = /pageId=(\d+)/g;
        while ((match = pageIdRegex.exec(html)) !== null) {
            if (!ids.includes(match[1])) {
                ids.push(match[1]);
            }
        }

        return ids;
    }

    /**
     * Parser ADR-er som er definert inline på hovedsiden (f.eks. i en tabell).
     */
    private parseInlineADRs(html: string, pageTitle: string): ADR[] {
        const adrs: ADR[] = [];

        // Prøv å finne tabellrader som inneholder ADR-info
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let match;
        let index = 0;

        while ((match = rowRegex.exec(html)) !== null) {
            const rowContent = match[1];
            const cells = this.extractTableCells(rowContent);

            if (cells.length >= 2 && index > 0) { // Hopp over header-rad
                const title = this.stripHtml(cells[0]).trim();
                if (title && title.toLowerCase().includes('adr')) {
                    adrs.push({
                        id: `inline-${index}`,
                        title: title,
                        htmlBody: rowContent,
                        plainText: cells.map(c => this.stripHtml(c).trim()).join(' | '),
                        url: `${this.baseUrl}/spaces/${this.spaceKey}/pages/${this.pageId}`,
                        status: cells.length > 2 ? this.stripHtml(cells[2]).trim() : 'Ukjent'
                    });
                }
            }
            index++;
        }

        // Fallback: Parse overskrifter som ADR-er
        if (adrs.length === 0) {
            const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
            let adrIndex = 0;
            while ((match = headingRegex.exec(html)) !== null) {
                const heading = this.stripHtml(match[1]).trim();
                if (heading.toLowerCase().includes('adr') || heading.match(/^\d+\./)) {
                    // Hent innholdet mellom denne overskriften og neste
                    const startPos = match.index + match[0].length;
                    const nextHeading = html.indexOf('<h', startPos);
                    const content = nextHeading > -1
                        ? html.substring(startPos, nextHeading)
                        : html.substring(startPos);

                    adrs.push({
                        id: `heading-${adrIndex}`,
                        title: heading,
                        htmlBody: content,
                        plainText: this.stripHtml(content).trim(),
                        url: `${this.baseUrl}/spaces/${this.spaceKey}/pages/${this.pageId}`,
                        status: 'Ukjent'
                    });
                    adrIndex++;
                }
            }
        }

        return adrs;
    }

    /**
     * Ekstraher innhold fra tabellceller.
     */
    private extractTableCells(rowHtml: string): string[] {
        const cells: string[] = [];
        const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let match;
        while ((match = cellRegex.exec(rowHtml)) !== null) {
            cells.push(match[1]);
        }
        return cells;
    }

    /**
     * Prøver å ekstrahere status fra ADR-innhold.
     */
    private extractStatus(html: string, plainText: string): string {
        // Søk etter vanlige status-indikatorer
        const statusPatterns = [
            /status[:\s]*(?:<[^>]*>)*\s*(akseptert|foreslått|avvist|erstattet|deprecated|accepted|proposed|rejected|superseded)/i,
            /\b(akseptert|foreslått|avvist|erstattet|accepted|proposed|rejected|superseded|deprecated)\b/i
        ];

        const combined = html + ' ' + plainText;
        for (const pattern of statusPatterns) {
            const match = combined.match(pattern);
            if (match) {
                return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
            }
        }

        return 'Ukjent';
    }

    /**
     * Fjerner HTML-tagger og returnerer ren tekst.
     */
    private stripHtml(html: string): string {
        // Bruk en HTML-parser for å ekstrahere ren tekst på en trygg måte
        const $ = cheerio.load(html);
        const text = $.root().text();
        return text.replace(/\s+/g, ' ').trim();
    }

    /**
     * Utfører et HTTP-kall mot Confluence REST API.
     */
    private async fetchFromConfluence(url: string): Promise<any> {
        // Bruk Node.js native fetch (tilgjengelig i VS Code 1.93+)
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.pat}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(
                `Confluence API-feil: ${response.status} ${response.statusText}. ` +
                `URL: ${url}. ${errorBody ? `Detaljer: ${errorBody}` : ''}`
            );
        }

        return response.json();
    }
}
