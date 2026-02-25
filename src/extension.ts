import * as vscode from 'vscode';
import { ConfluenceClient, ADR } from './confluenceClient';
import { RepoAnalyzer } from './repoAnalyzer';

let cachedADRs: ADR[] | null = null;

export function activate(context: vscode.ExtensionContext) {

    const participant = vscode.chat.createChatParticipant('adr-sjekk.checker', handler);
    participant.iconPath = new vscode.ThemeIcon('checklist');

    context.subscriptions.push(participant);
}

async function handler(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {

    const command = request.command;

    if (command === 'list') {
        return await handleList(request, stream, token);
    } else if (command === 'detaljer') {
        return await handleDetails(request, stream, token);
    } else {
        // Default: /sjekk eller ingen kommando
        return await handleCheck(request, stream, token);
    }
}

/**
 * /sjekk - Hovedkommando: sjekk repoet mot alle ADR-er
 */
async function handleCheck(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {

    // 1. Valider konfigurasjon
    const client = new ConfluenceClient();
    const validationError = client.validateConfig();
    if (validationError) {
        stream.markdown(`⚠️ **Konfigurasjonsfeil:** ${validationError}\n\n`);
        stream.markdown('Konfigurer PAT med:\n```\n"adr-sjekk.confluencePat": "din-pat-her"\n```\n');
        return { metadata: { command: 'sjekk' } };
    }

    // 2. Hent ADR-er fra Confluence
    stream.progress('Henter ADR-er fra Confluence...');
    let adrs: ADR[];
    try {
        adrs = await fetchADRsWithCache(client);
    } catch (e: any) {
        stream.markdown(`❌ **Kunne ikke hente ADR-er fra Confluence:**\n\n${e.message}\n`);
        return { metadata: { command: 'sjekk' } };
    }

    if (adrs.length === 0) {
        stream.markdown('⚠️ Ingen ADR-er funnet på den konfigurerte Confluence-siden.\n');
        return { metadata: { command: 'sjekk' } };
    }

    stream.markdown(`📋 Fant **${adrs.length} ADR-er** fra Confluence. Analyserer repoet...\n\n`);

    // 3. Samle repo-kontekst
    stream.progress('Analyserer repo-struktur...');
    const repoAnalyzer = new RepoAnalyzer();
    let repoContext: string;
    try {
        repoContext = await repoAnalyzer.gatherRepoContext();
    } catch (e: any) {
        stream.markdown(`❌ **Kunne ikke analysere repoet:** ${e.message}\n`);
        return { metadata: { command: 'sjekk' } };
    }

    // 4. Bygg prompt for LLM-analyse
    stream.progress('Sjekker samsvar med ADR-er...');

    const adrSummaries = adrs.map((adr, i) =>
        `### ADR ${i + 1}: ${adr.title}\n${adr.plainText.substring(0, 1500)}\n`
    ).join('\n---\n');

    const prompt = buildCheckPrompt(adrSummaries, repoContext, request.prompt);

    // 5. Send til LLM for analyse
    const messages = [
        vscode.LanguageModelChatMessage.User(prompt)
    ];

    try {
        const models = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'gpt-4o'
        });

        if (models.length === 0) {
            stream.markdown('❌ Ingen tilgjengelig språkmodell funnet. Sørg for at GitHub Copilot er aktivert.\n');
            return { metadata: { command: 'sjekk' } };
        }

        const model = models[0];
        const response = await model.sendRequest(messages, {}, token);

        for await (const fragment of response.text) {
            stream.markdown(fragment);
        }
    } catch (e: any) {
        stream.markdown(`❌ **Feil under analyse:** ${e.message}\n`);
    }

    // 6. Legg til lenke til Confluence
    stream.markdown('\n\n---\n');
    stream.markdown(`📖 [Se alle ADR-er i Confluence](${getConfluenceUrl()})\n`);

    return { metadata: { command: 'sjekk' } };
}

/**
 * /list - List alle ADR-er hentet fra Confluence
 */
async function handleList(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {

    const client = new ConfluenceClient();
    const validationError = client.validateConfig();
    if (validationError) {
        stream.markdown(`⚠️ **Konfigurasjonsfeil:** ${validationError}\n`);
        return { metadata: { command: 'list' } };
    }

    stream.progress('Henter ADR-er fra Confluence...');

    let adrs: ADR[];
    try {
        adrs = await fetchADRsWithCache(client);
    } catch (e: any) {
        stream.markdown(`❌ **Kunne ikke hente ADR-er:** ${e.message}\n`);
        return { metadata: { command: 'list' } };
    }

    if (adrs.length === 0) {
        stream.markdown('Ingen ADR-er funnet.\n');
        return { metadata: { command: 'list' } };
    }

    stream.markdown(`# ADR-er for området\n\n`);
    stream.markdown(`Totalt **${adrs.length} ADR-er** funnet:\n\n`);

    for (let i = 0; i < adrs.length; i++) {
        const adr = adrs[i];
        const statusIcon = getStatusIcon(adr.status);
        stream.markdown(`${i + 1}. ${statusIcon} **${adr.title}**\n`);
        stream.markdown(`   - Status: ${adr.status}\n`);
        stream.markdown(`   - [Åpne i Confluence](${adr.url})\n\n`);
    }

    stream.markdown(`\n📖 [Se alle i Confluence](${getConfluenceUrl()})\n`);

    return { metadata: { command: 'list' } };
}

/**
 * /detaljer - Vis detaljer for en spesifikk ADR
 */
async function handleDetails(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {

    const client = new ConfluenceClient();
    const validationError = client.validateConfig();
    if (validationError) {
        stream.markdown(`⚠️ **Konfigurasjonsfeil:** ${validationError}\n`);
        return { metadata: { command: 'detaljer' } };
    }

    const query = request.prompt.trim();
    if (!query) {
        stream.markdown('Skriv inn ADR-nummer eller tittel. Eksempel: `@adr-sjekk /detaljer 3` eller `@adr-sjekk /detaljer logging`\n');
        return { metadata: { command: 'detaljer' } };
    }

    stream.progress('Henter ADR-er...');

    let adrs: ADR[];
    try {
        adrs = await fetchADRsWithCache(client);
    } catch (e: any) {
        stream.markdown(`❌ **Feil:** ${e.message}\n`);
        return { metadata: { command: 'detaljer' } };
    }

    // Finn ADR basert på nummer eller tittel-søk
    let matchedAdr: ADR | undefined;
    const num = parseInt(query, 10);
    if (!isNaN(num) && num >= 1 && num <= adrs.length) {
        matchedAdr = adrs[num - 1];
    } else {
        matchedAdr = adrs.find(a =>
            a.title.toLowerCase().includes(query.toLowerCase())
        );
    }

    if (!matchedAdr) {
        stream.markdown(`Fant ingen ADR som matcher "${query}". Bruk \`@adr-sjekk /list\` for å se alle.\n`);
        return { metadata: { command: 'detaljer' } };
    }

    stream.markdown(`# ${matchedAdr.title}\n\n`);
    stream.markdown(`**Status:** ${matchedAdr.status}\n\n`);
    stream.markdown(`**Confluence-lenke:** [Åpne](${matchedAdr.url})\n\n`);
    stream.markdown(`---\n\n`);

    // Bruk LLM til å oppsummere ADR-innholdet pent
    const summaryPrompt = `Du er en teknisk arkitekt. Oppsummer følgende ADR (Architecture Decision Record) på norsk, med fokus på:
1. Kontekst/bakgrunn
2. Beslutning
3. Konsekvenser
4. Hvordan man verifiserer at et repo følger denne ADR-en

ADR-innhold:
${matchedAdr.plainText.substring(0, 4000)}`;

    try {
        const models = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'gpt-4o'
        });

        if (models.length > 0) {
            const messages = [vscode.LanguageModelChatMessage.User(summaryPrompt)];
            const response = await models[0].sendRequest(messages, {}, token);
            for await (const fragment of response.text) {
                stream.markdown(fragment);
            }
        } else {
            // Fallback: vis ren tekst
            stream.markdown(matchedAdr.plainText.substring(0, 4000));
        }
    } catch {
        stream.markdown(matchedAdr.plainText.substring(0, 4000));
    }

    return { metadata: { command: 'detaljer' } };
}

/**
 * Bygger prompts for ADR-sjekkanalyse.
 */
function buildCheckPrompt(adrSummaries: string, repoContext: string, userPrompt: string): string {
    return `Du er en erfaren teknisk arkitekt som gjennomfører en ADR-compliance-sjekk (Architecture Decision Records).

## Oppgave
Analyser det gitte repositoryet mot alle ADR-er og gi en detaljert samsvarsvurdering.

## ADR-er å sjekke mot:
${adrSummaries}

## Repo-kontekst:
${repoContext}

${userPrompt ? `## Brukerens tilleggsforespørsel:\n${userPrompt}\n` : ''}

## Instruksjoner for analysen:
Svar på **norsk**. For hver ADR, gi følgende:

1. **Status-ikon:**
   - ✅ Følger ADR-en (compliant)
   - ❌ Bryter med ADR-en (non-compliant)
   - ⚠️ Trenger manuell gjennomgang (needs-review)
   - ➖ Ikke relevant for dette repoet (not-applicable)

2. **Kort forklaring** av hvorfor du vurderer det slik
3. **Anbefalte tiltak** dersom repoet ikke følger ADR-en

## Format:
Start med en **oppsummering** (antall OK, antall brudd, antall trenger gjennomgang).
Deretter gå gjennom hver ADR med overskrift, status og begrunnelse.
Avslutt med **prioriterte anbefalinger** for de viktigste tiltakene.

Vær konkret og referer til spesifikke filer/konfigurasjoner du har sett (eller mangelen på dem).
Dersom du ikke har nok informasjon til å vurdere en ADR, merk den som "trenger manuell gjennomgang" og forklar hva som mangler.`;
}

/**
 * Hent ADR-er med caching (revaliderer ved ny sesjon).
 */
async function fetchADRsWithCache(client: ConfluenceClient): Promise<ADR[]> {
    if (cachedADRs !== null) {
        return cachedADRs;
    }
    cachedADRs = await client.fetchAllADRs();
    return cachedADRs;
}

/**
 * Returnerer status-ikon basert på ADR-status.
 */
function getStatusIcon(status: string): string {
    const lower = status.toLowerCase();
    if (lower.includes('akseptert') || lower.includes('accepted')) { return '✅'; }
    if (lower.includes('foreslått') || lower.includes('proposed')) { return '🔄'; }
    if (lower.includes('avvist') || lower.includes('rejected')) { return '❌'; }
    if (lower.includes('erstattet') || lower.includes('superseded') || lower.includes('deprecated')) { return '⚠️'; }
    return '📄';
}

/**
 * Bygger full Confluence-URL fra innstillinger.
 */
function getConfluenceUrl(): string {
    const config = vscode.workspace.getConfiguration('adr-sjekk');
    const baseUrl = config.get<string>('confluenceBaseUrl', 'https://www.vegvesen.no/wiki');
    const pageId = config.get<string>('confluencePageId', '256675250');
    return `${baseUrl}/pages/viewpage.action?pageId=${pageId}`;
}

export function deactivate() {
    cachedADRs = null;
}
