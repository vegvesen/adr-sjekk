# ADR-sjekk — GitHub Copilot Skill

En VS Code Chat Participant-extension (GitHub Copilot Skill) som sjekker at et repo følger gjeldende **ADR-er (Architecture Decision Records)** fra Confluence.

## Funksjoner

| Kommando | Beskrivelse |
|---|---|
| `@adr-sjekk /sjekk` | Sjekk repoet mot alle ADR-er og få en compliance-rapport |
| `@adr-sjekk /list` | List alle ADR-er hentet fra Confluence |
| `@adr-sjekk /detaljer <nr/tittel>` | Vis detaljer for en spesifikk ADR |
| `@adr-sjekk /settPAT` | Lagre Confluence PAT sikkert i SecretStorage |
| `@adr-sjekk /fjernPAT` | Slett lagret Confluence PAT fra SecretStorage |
| `@adr-sjekk /authstatus` | Diagnostikk: sjekk konfigurasjon og live-test Confluence-tilkobling |

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
  "adr-sjekk.confluenceSpaceKey": "XX"
}
```

> **Merk:** `confluenceBaseUrl` må starte med `https://`. HTTP-URLer avvises.

### 3. Sett Confluence PAT (Personal Access Token)

PAT lagres **aldri** i `settings.json` — den oppbevares kryptert i VS Codes [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage).

**Alternativ A — via chat:**

```
@adr-sjekk /settPAT
```

**Alternativ B — via kommandopaletten** (`Ctrl+Shift+P`):

```
ADR-sjekk: Sett Confluence PAT (sikker lagring)
```

Begge åpner et passord-maskert inputfelt. Lim inn tokenet og trykk Enter — det lagres kryptert og brukes automatisk ved alle Confluence-kall.

#### Fjerne lagret PAT

```
@adr-sjekk /fjernPAT
```

eller via kommandopaletten: **ADR-sjekk: Fjern lagret Confluence PAT**

#### Verifisere tilkoblingen

```
@adr-sjekk /authstatus
```

Viser konfigurasjonsstatus (HTTPS ✅/❌, PAT funnet ✅/❌, fingerprint) og kjører en live auth-test mot Confluence.

#### Hvordan lage PAT i Confluence

1. Gå til din Confluence-profil → **Personal Access Tokens**
2. Klikk **Create token**
3. Gi tokenet et navn og velg riktig utløpsdato
4. Kopier tokenet
5. Lim det inn via `@adr-sjekk /settPAT` eller kommandopaletten

### 4. Krav

- **VS Code** 1.93 eller nyere
- **GitHub Copilot Chat** extension installert og aktiv
- Nettverkstilgang til Confluence-instansen

## Konfigurasjon

| Innstilling | Standard | Beskrivelse |
|---|---|---|
| `adr-sjekk.confluenceBaseUrl` | `https://www.vegvesen.no/wiki` | Base-URL for Confluence (må bruke HTTPS) |
| `adr-sjekk.confluencePageId` | `12345678` | Side-ID for ADR-oversikten |
| `adr-sjekk.confluenceSpaceKey` | `XX` | Confluence Space Key |

> **PAT lagres ikke i innstillingene.** Bruk `@adr-sjekk /settPAT` eller kommandopaletten for sikker lagring i SecretStorage.

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

#Installer Extensions
code --install-extension ./adr-sjekk-0.2.0.vsix

```
Hvis "code" syntaksen mangler i terminal:
  Ctrl/CMD + Shift + P
  søke etter:  "Shell Command: Install 'code' command in PATH"

Eller trykk **F5** for å åpne Extension Development Host med extensionen lastet.






## Lisens

MIT
