# Copilot Instructions — adr-sjekk

VS Code Chat Participant-extension (GitHub Copilot Skill) som sjekker at et repo følger ADR-er (Architecture Decision Records) fra Confluence.

## Prosjektstruktur

```
src/
├── extension.ts          # Aktivering, chat participant, kommandoregistrering, PAT-håndtering
├── confluenceClient.ts   # Confluence REST API-klient (henter og parser ADR-er)
└── repoAnalyzer.ts       # Samler repo-kontekst (filer, deps, CI/CD) for LLM-analyse
```

- Kompilert output i `out/` (ikke sjekk inn)
- Bundlet extension i `*.vsix`

## Teknologi

- **TypeScript** med strict-modus (`tsconfig.json`)
- **VS Code Extension API** — chat participants, SecretStorage, konfigurasjonsAPI
- **cheerio** for HTML-parsing av Confluence-innhold
- **Node.js native `fetch`** for HTTP-kall (krever VS Code ≥ 1.109)

## Viktige konvensjoner

### Sikkerhet — PAT håndtering
- **PAT lagres utelukkende i `extensionContext.secrets` (SecretStorage)** — aldri i `settings.json` eller kildekode
- `ConfluenceClient` tar PAT som constructor-argument, leser det ikke selv fra config
- `createClient()` i `extension.ts` henter PAT fra SecretStorage og normaliserer den med `normalizePatToken()`
- `confluenceBaseUrl` **må bruke HTTPS** — `validateConfig()` avviser HTTP-URLer

### ConfluenceClient
- Konstruktørargument: `pat: string`
- Leser `confluenceBaseUrl`, `confluencePageId`, `confluenceSpaceKey` fra VS Code-konfig
- `validateConfig()` sjekker HTTPS-krav og at PAT er tilstede
- Alle API-kall går via `fetchFromConfluence(url)` med `Authorization: Bearer <pat>`

### Chat-kommandoer
| Kommando | Handler |
|---|---|
| `/sjekk` (default) | `handleCheck` — henter ADR-er, analyserer repo, sender til LLM |
| `/list` | `handleList` — lister alle ADR-er |
| `/detaljer` | `handleDetails` — detaljer for én ADR via LLM-oppsummering |
| `/settPAT` | `handleSettPAT` — lagrer PAT i SecretStorage |
| `/fjernPAT` | `handleFjernPAT` — sletter PAT fra SecretStorage |
| `/authstatus` | `handleAuthStatus` — diagnostikk og live auth-test |

### Feilhåndtering
- Valideringsfeil returneres tidlig med `⚠️`-melding og instruksjon om `/settPAT`
- API-feil fra Confluence vises til bruker med full feilmelding
- LLM-feil (ingen modell, sendRequest-feil) håndteres gracefully

## Konfigurasjon (settings.json)

```json
{
  "adr-sjekk.confluenceBaseUrl": "https://confluence.example.com",
  "adr-sjekk.confluencePageId": "12345678",
  "adr-sjekk.confluenceSpaceKey": "XX"
}
```

PAT settes via `@adr-sjekk /settPAT` eller kommandopaletten **ADR-sjekk: Sett Confluence PAT**.

## Bygge og teste

```bash
npm install
npm run compile       # Engangskompilering
npm run watch         # Watch-modus under utvikling
npm run package       # Bygg .vsix-fil
```

Trykk **F5** i VS Code for å åpne Extension Development Host.
