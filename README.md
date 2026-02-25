# ADR-sjekk — GitHub Copilot Skill

En VS Code Chat Participant-extension (GitHub Copilot Skill) som sjekker at et repo følger gjeldende **ADR-er (Architecture Decision Records)** fra Confluence.

## Funksjoner

| Kommando | Beskrivelse |
|---|---|
| `@adr-sjekk /sjekk` | Sjekk repoet mot alle ADR-er og få en compliance-rapport |
| `@adr-sjekk /list` | List alle ADR-er hentet fra Confluence |
| `@adr-sjekk /detaljer <nr/tittel>` | Vis detaljer for en spesifikk ADR |

Du kan også skrive fritt til `@adr-sjekk`, f.eks.:
- `@adr-sjekk Sjekk om vi bruker riktig logging-rammeverk`
- `@adr-sjekk Er vår CI/CD-pipeline i henhold til ADR-ene?`

## Slik fungerer det

1. **Henter ADR-er** fra Confluence via REST API (autentisert med PAT)
2. **Analyserer repoet** — filstruktur, konfigurasjonsfiler, avhengigheter, CI/CD-oppsett, osv.
3. **Bruker Copilot LLM** til å vurdere hvert repo-aspekt mot hver ADR
4. **Rapporterer resultat** med statusikoner og anbefalte tiltak

## Oppsett

### 1. Installer extensionen

```bash
# Klon repoet
git clone <repo-url>
cd adr-sjekk

# Installer avhengigheter
npm install

# Bygg
npm run compile

# Pakke som VSIX (valgfritt)
npm run package
```

For utvikling: Trykk **F5** i VS Code for å starte Extension Development Host.

### 2. Konfigurer Confluence-tilkobling

Legg til følgende i VS Code-innstillingene (`settings.json`):

```json
{
  "adr-sjekk.confluenceBaseUrl": "https://www.vegvesen.no/wiki",
  "adr-sjekk.confluencePageId": "12345678",
  "adr-sjekk.confluenceSpaceKey": "XX",
  "adr-sjekk.confluencePat": "din-personal-access-token"
}
```

#### Hvordan lage PAT i Confluence

1. Gå til din Confluence-profil → **Personal Access Tokens**
2. Klikk **Create token**
3. Gi tokenet et navn og velg riktig utløpsdato
4. Kopier tokenet og legg det inn i innstillingene over

> ⚠️ **Sikkerhet:** PAT-en gir tilgang til Confluence. Ikke sjekk den inn i kildekode. Vurder å bruke VS Code Secret Storage i produksjon.

### 3. Krav

- **VS Code** 1.93 eller nyere
- **GitHub Copilot Chat** extension installert og aktiv
- Nettverkstilgang til Confluence-instansen

## Konfigurasjon

| Innstilling | Standard | Beskrivelse |
|---|---|---|
| `adr-sjekk.confluenceBaseUrl` | `https://www.vegvesen.no/wiki` | Base-URL for Confluence |
| `adr-sjekk.confluencePageId` | `12345678` | Side-ID for ADR-oversikten |
| `adr-sjekk.confluenceSpaceKey` | `XX` | Confluence Space Key |
| `adr-sjekk.confluencePat` | *(tom)* | Personal Access Token |

## Arkitektur

```
src/
├── extension.ts          # Hovedinngang, registrerer chat participant
├── confluenceClient.ts   # Confluence REST API-klient
└── repoAnalyzer.ts       # Samler repo-kontekst for analyse
```

### Flyt

```
Bruker → @adr-sjekk /sjekk
  ↓
  ├── ConfluenceClient.fetchAllADRs()    → Henter ADR-er via API
  ├── RepoAnalyzer.gatherRepoContext()   → Analyserer repoets filer
  └── Copilot LLM                       → Vurderer compliance
  ↓
Rapport med ✅/❌/⚠️ per ADR
```

### Strategier for ADR-henting

Extensionen prøver flere strategier for å hente ADR-er fra Confluence:

1. **Child pages** — Henter undersider av ADR-oversikten
2. **Lenkede sider** — Parser interne lenker i oversiktssiden
3. **Inline-innhold** — Parser ADR-tabeller/overskrifter direkte fra oversiktssiden

## Utvikling

```bash
# Installer avhengigheter
npm install

# Kompiler
npm run compile

# Kjør i watch-modus
npm run watch
```

Trykk **F5** for å åpne Extension Development Host med extensionen lastet.

## Lisens

MIT
