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
| `GET /api/items?status=open\|ordered` | iedereen op de whitelist | lijst ophalen |
| `POST /api/items` | iedereen op de whitelist | verzoek toevoegen |
| `PATCH /api/items/:id` | beheerder, of jezelf bij een eigen open verzoek | status of aantal wijzigen |
| `DELETE /api/items/:id` | beheerder | definitief verwijderen |
| `POST /api/order-all` | beheerder | alles open op besteld |
| `GET /api/frequent` | iedereen op de whitelist | vaker besteld |
| `GET /api/search?q=` | iedereen op de whitelist | AH-producten zoeken |
| `POST /api/admin` | — | beheerderscode controleren |

De beheerderscode gaat mee als `X-Admin-Code`-header en wordt serverside
gecontroleerd. In de browser onthoudt de tool hem 30 dagen.

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

**Verwijderd item terughalen:** verwijderen via de knop is een soft delete. De rij
staat nog in D1 met een `deleted_at`; in de D1-console kun je `status` terugzetten
op `open`. Alleen `DELETE /api/items/:id` verwijdert echt.

**Er staan geen geheimen in de repo.** De beheerderscode en de IP-lijst leven als
omgevingsvariabelen in Cloudflare.

## Lokaal draaien

Er is geen dev-server nodig om aan de CSS of HTML te werken, maar wil je de API
erbij, dan kan dat met Wrangler:

```bash
npx wrangler pages dev . --d1 DB
```
