# Boodschappen

Interne tool om wekelijkse boodschappenwensen te verzamelen. Collega's zetten een
product op de lijst, één persoon bestelt de hele ronde bij Albert Heijn.

- Producten komen rechtstreeks uit de AH-productcatalogus: zoeken, aanklikken, klaar.
- Wat vaker besteld wordt, verschijnt onder **Vaker besteld** en gaat met één klik
  terug op de lijst.
- De besteller zet de hele lijst in één keer op besteld.

## Hoe het werkt

Statische frontend plus Cloudflare Pages Functions, met D1 (SQLite) als database.
Er is geen build-stap en geen framework-installatie: Alpine.js komt van een CDN.

Frontend en API draaien op hetzelfde domein. Daarom is er geen CORS in het spel en
is er geen proxy nodig om bij `api.ah.nl` te komen: de Function doet die aanroep
serverside, waar CORS niet bestaat.

```
index.html            de hele UI
app.js                Alpine-component
stats.html            statistieken per persoon (logboek + top 10)
stats.js              Alpine-component voor stats.html
styles.css            4net-huisstijl
functions/
  _middleware.js      IP-controle voor alle routes
  api/                de endpoints
lib/                  gedeelde code (AH, database, toegang)
schema.sql            het databaseschema
```

### Endpoints

| Route | Wie | Wat |
|---|---|---|
| `GET /api/items?status=open\|ordered\|deleted\|rejected` | iedereen op de whitelist | lijst ophalen |
| `POST /api/items` | iedereen op de whitelist | verzoek toevoegen |
| `PATCH /api/items/:id` | beheerder, of jezelf bij een eigen open verzoek | status of aantal wijzigen |
| `DELETE /api/items/:id` | beheerder | definitief verwijderen |
| `POST /api/order-all` | beheerder | alles open op besteld |
| `GET /api/frequent` | iedereen op de whitelist | vaker besteld |
| `GET /api/search?q=` | iedereen op de whitelist | AH-producten zoeken |
| `GET /api/stats` | iedereen op de whitelist | lijst van personen die ooit iets aanvroegen |
| `GET /api/stats?requester=Naam` | iedereen op de whitelist | logboek + top 10 meest bestelde producten van die persoon |
| `POST /api/admin` | — | beheerderscode controleren |

`stats.html` is een puur informatieve, aparte pagina (geen basisfunctionaliteit)
en vereist bewust geen beheerderscode — alleen de IP-whitelist.

De beheerderscode gaat mee als `X-Admin-Code`-header en wordt serverside
gecontroleerd. In de browser onthoudt de tool hem 30 dagen.

### Statussen van een item

Een item doorloopt `open` → `ordered` (besteld), of verlaat de open lijst op één
van twee manieren die bewust gescheiden zijn:

- **`deleted`** — de aanvrager trekt zijn eigen open verzoek in (`Intrekken`).
  Geen reden nodig, geen beheerder nodig.
- **`rejected`** — de beheerder wijst het verzoek af (`Verwijderen`) en kan er
  optioneel een reden (`reject_reason`) bij geven. Deze items komen terug in de
  tab **Afgewezen**, zichtbaar voor iedereen — intrekkingen (`deleted`) juist
  niet, dat overzicht is uitsluitend voor beheerdersbeslissingen.

Beide zijn een soft delete: de rij blijft in D1 staan met een `deleted_at`.
Alleen `DELETE /api/items/:id` verwijdert een rij echt — een beheerder kan dit
vanuit de tab **Afgewezen** doen met **Definitief verwijderen**.

De tab **Afgewezen** toont alleen afwijzingen van de laatste 30 dagen
(`REJECTED_VISIBLE_DAYS` in [`functions/api/items/index.js`](functions/api/items/index.js)).
Oudere afwijzingen blijven gewoon bewaard en verschijnen wel volledig in het
logboek op de statistiekenpagina — dat filter geldt alleen voor deze tab, niet
voor `/api/stats`.

### Toegang

`functions/_middleware.js` vergelijkt `CF-Connecting-IP` met de variabele
`ALLOWED_IPS`. Die header zet Cloudflare zelf; de bezoeker kan hem niet vervalsen.
Losse adressen en CIDR-notatie werken allebei, IPv4 en IPv6:

```
185.38.90.170, 2a02:1234:5678::/48
```

Staat `ALLOWED_IPS` niet ingesteld, dan is de tool voor niemand bereikbaar. Dat is
opzet: een vergeten instelling mag de deur niet stilletjes openzetten. Wie geweigerd
wordt, ziet zijn eigen IP-adres op het scherm en kan dat doorsturen.

## Eenmalige installatie

Alles in de Cloudflare-dashboard, geen command line nodig.

1. Maak een gratis account op [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Workers & Pages → D1 → Create**, naam `boodschappen`. Open de Console-tab, plak
   de inhoud van [`schema.sql`](schema.sql) en voer die uit.
3. **Workers & Pages → Create → Pages → Connect to Git**, kies deze repo, branch
   `main`. Build command leeg laten, output directory `/`.
4. **Settings → Bindings → D1**: variabelenaam `DB`, database `boodschappen`. Doe dit
   voor zowel Production als Preview.
5. **Settings → Variables and Secrets**:
   - `ADMIN_CODE` als **Secret** — de beheerderscode.
   - `ALLOWED_IPS` als gewone variabele — komma-gescheiden lijst.
6. Deploy opnieuw. Bindings en variabelen worden pas actief bij de volgende
   deployment, dus één keer **Retry deployment** is nodig.

## Onderhoud

**Collega toevoegen of verwijderen:** de lijst met namen staat bovenin
[`app.js`](app.js) als `NAMES`.

**Iemand krijgt geen toegang:** laat diegene het IP-adres van de weigerpagina
doorsturen en voeg het toe aan `ALLOWED_IPS`. Wisselt het adres vaak, gebruik dan
CIDR (`2a02:1234:5678::/48`) in plaats van losse adressen.

**Ingetrokken of afgewezen item terughalen:** zie [Statussen van een item](#statussen-van-een-item)
hierboven — beide zijn een soft delete. In de D1-console kun je `status`
terugzetten op `open` (en voor een afwijzing ook `reject_reason` leegmaken).

**Er staan geen geheimen in de repo.** De beheerderscode en de IP-lijst leven als
omgevingsvariabelen in Cloudflare.

## Lokaal draaien

Er is geen dev-server nodig om aan de CSS of HTML te werken, maar wil je de API
erbij (dus ook echte data zien), dan kan dat met Wrangler. Let op: openen via
een simpele static file server (zoals VS Code's Live Preview) werkt niet — die
voert `functions/` niet uit, dus `/api/...`-aanroepen geven altijd 404.

**Eenmalige setup:**

1. Maak lokaal (niet committen, staat al in `.gitignore`) een `wrangler.toml`:

   ```toml
   name = "boodschappen"
   pages_build_output_dir = "."

   [[d1_databases]]
   binding = "DB"
   database_name = "boodschappen"
   database_id = "<database-id-uit-cloudflare-dashboard>"
   ```

2. Maak een `.dev.vars` (ook gitignored):

   ```
   ADMIN_CODE=iets-om-lokaal-mee-in-te-loggen
   ALLOWED_IPS=127.0.0.1
   LOCAL_DEV=1
   ```

   `LOCAL_DEV=1` is nodig omdat `wrangler pages dev` lokaal geen
   `CF-Connecting-IP`-header meestuurt — zonder die vlag houdt de
   IP-whitelist in [`functions/_middleware.js`](functions/_middleware.js) je
   altijd buiten de deur, ook al staat `127.0.0.1` in `ALLOWED_IPS`. Deze
   variabele bestaat alleen lokaal en heeft geen enkel effect in productie.

3. Zet het schema op de lokale D1 (die begint leeg, los van productie):

   ```bash
   npx wrangler d1 execute DB --local --file=schema.sql
   ```

**Starten:**

```bash
npx wrangler pages dev .
```

Dit draait tegen de **lokale** D1, niet tegen productie — er bestaat geen
`--remote`-vlag voor `wrangler pages dev`. Wil je met echte data testen,
exporteer dan eenmalig de productiedata en importeer die lokaal:

```bash
npx wrangler d1 export boodschappen --remote --output=export.sql
npx wrangler d1 execute DB --local --file=export.sql
```

Wijzig je het schema (zoals `reject_reason`), voer dezelfde `ALTER TABLE`
dan ook los uit op de lokale database én op productie met `--remote`.
