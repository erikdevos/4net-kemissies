import { frequentProducts } from '../../lib/db.js';
import { json } from '../../lib/http.js';

export async function onRequestGet({ env }) {
  const products = await frequentProducts(env.DB, 24);
  return json({ products });
}
