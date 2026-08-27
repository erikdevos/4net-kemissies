// Albert Heijn productzoeken.
//
// De browser mag api.ah.nl niet rechtstreeks aanroepen (CORS). Deze module draait
// serverside in een Cloudflare Function, waar CORS niet bestaat.
//
// Twee dingen zijn niet-onderhandelbaar en waren de reden dat de oude proxy faalde:
//   1. de zoek-endpoint eist de header X-Application: AHWEBSHOP, anders volgt
//      HTTP 500 "Can not find application: 'null'";
//   2. producten zonder bonus hebben currentPrice: null, dus de prijs moet
//      terugvallen op priceBeforeBonus.

const TOKEN_URL = 'https://api.ah.nl/mobile-auth/v1/auth/token/anonymous';
const SEARCH_URL = 'https://api.ah.nl/mobile-services/product/search/v2';
const USER_AGENT = 'Appie/8.22.3';

// Het anonieme token is een week geldig, dus cachen scheelt vrijwel elke call.
// Deze cache leeft per isolate; verdwijnt hij, dan wordt er simpelweg een nieuw
// token gehaald.
let cachedToken = null;

async function fetchToken() {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ clientId: 'appie' }),
  });

  if (!response.ok) {
    throw new Error(`AH-token mislukt (HTTP ${response.status})`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('AH-token ontbreekt in de respons');
  }

  // Een minuut marge, zodat een token nooit net tijdens een call verloopt.
  const ttl = (data.expires_in || 3600) * 1000 - 60_000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttl };
  return cachedToken.token;
}

async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  return fetchToken();
}

function mapProduct(product) {
  const id = product.webshopId || null;
  return {
    productId: id,
    title: product.title || 'Onbekend product',
    brand: product.brand || '',
    unitSize: product.salesUnitSize || '',
    imageUrl: pickImage(product.images),
    productUrl: id ? `https://www.ah.nl/producten/product/wi${id}` : '',
    price: product.currentPrice ?? product.priceBeforeBonus ?? null,
    isBonus: Boolean(product.isBonus),
  };
}

function pickImage(images) {
  if (!Array.isArray(images) || images.length === 0) return '';
  // Kies de kleinste afbeelding van minimaal 200px; scheelt laadtijd in de lijst.
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  const usable = sorted.find((img) => (img.width || 0) >= 200) || sorted[sorted.length - 1];
  return usable?.url || '';
}

export async function searchProducts(query, size = 12) {
  const trimmed = (query || '').trim();
  if (trimmed.length < 2) return [];

  const run = async (token) => {
    const url = `${SEARCH_URL}?query=${encodeURIComponent(trimmed)}&sortOn=RELEVANCE&size=${size}`;
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Application': 'AHWEBSHOP',
        'User-Agent': USER_AGENT,
      },
    });
  };

  let response = await run(await getToken());

  // Een verlopen of ingetrokken token: één keer opnieuw proberen met een vers token.
  if (response.status === 401 || response.status === 403) {
    cachedToken = null;
    response = await run(await fetchToken());
  }

  if (!response.ok) {
    throw new Error(`AH-zoeken mislukt (HTTP ${response.status})`);
  }

  const data = await response.json();
  if (!Array.isArray(data.products)) return [];

  return data.products.filter((p) => p.webshopId).slice(0, size).map(mapProduct);
}
