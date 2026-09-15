import { json } from '../../lib/http.js';

// Zegt de frontend of dit de testomgeving is, zodat het "TEST"-label naast de
// titel getoond kan worden. Puur cosmetisch, dus geen admincode nodig - net
// als /api/stats mag iedereen op de IP-whitelist dit zien.
export async function onRequestGet({ env }) {
  return json({ isTest: env.ENVIRONMENT === 'test' });
}
