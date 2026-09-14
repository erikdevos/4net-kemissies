import { listRequesters, itemLog, topProductsByRequester } from '../../lib/db.js';
import { json } from '../../lib/http.js';

// Zonder ?requester=: de personenkeuze. Met ?requester=: logboek + top 10 voor
// die persoon. Puur informatief, dus geen admincode nodig - iedereen op de
// whitelist mag dit zien.
export async function onRequestGet({ request, env }) {
  const requester = new URL(request.url).searchParams.get('requester');

  if (!requester) {
    const requesters = await listRequesters(env.DB);
    return json({ requesters });
  }

  const [log, topProducts] = await Promise.all([
    itemLog(env.DB, requester),
    topProductsByRequester(env.DB, requester),
  ]);

  return json({ log, topProducts });
}
