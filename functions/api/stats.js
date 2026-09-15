import {
  listRequesters,
  itemLog,
  topProductsByRequester,
  topProductsOverall,
  mostRequestedProduct,
} from '../../lib/db.js';
import { json } from '../../lib/http.js';

// Zonder ?requester=: de personenkeuze plus het globale overzicht. Met
// ?requester=: logboek + top 10 voor die persoon. Puur informatief, dus geen
// admincode nodig - iedereen op de whitelist mag dit zien.
export async function onRequestGet({ request, env }) {
  const requester = new URL(request.url).searchParams.get('requester');

  if (!requester) {
    const [requesters, topOverall, topProduct] = await Promise.all([
      listRequesters(env.DB),
      topProductsOverall(env.DB),
      mostRequestedProduct(env.DB),
    ]);
    // Leuke weetjes, geen kostenoverzicht: wie zet de meeste verzoekjes op de
    // lijst, en welk product wordt het vaakst aangevraagd (ongeacht status).
    const topRequester = requesters.reduce(
      (best, r) => (!best || r.total > best.total ? r : best),
      null,
    );
    return json({ requesters, topOverall, topRequester, topProduct });
  }

  const [log, topProducts] = await Promise.all([
    itemLog(env.DB, requester),
    topProductsByRequester(env.DB, requester),
  ]);

  return json({ log, topProducts });
}
