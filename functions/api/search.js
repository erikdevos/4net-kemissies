import { searchProducts } from '../../lib/ah.js';
import { json, error } from '../../lib/http.js';

export async function onRequestGet({ request }) {
  const query = new URL(request.url).searchParams.get('q') || '';
  if (query.trim().length < 2) return json({ products: [] });

  try {
    const products = await searchProducts(query, 12);
    return json({ products });
  } catch (err) {
    // De AH-API is van een derde partij; als die wegvalt moet de tool dat netjes
    // melden in plaats van een lege lijst te tonen alsof er niets bestaat.
    return error(`Zoeken bij Albert Heijn lukt nu niet: ${err.message}`, 502);
  }
}
