import { getItem, setStatus, hardDelete, updateQuantity, includesRequester } from '../../../lib/db.js';
import { isAdmin } from '../../../lib/auth.js';
import { json, error, readJson } from '../../../lib/http.js';

const STATUSES = ['open', 'ordered', 'deleted', 'rejected'];

export async function onRequestPatch({ request, env, params }) {
  const item = await getItem(env.DB, params.id);
  if (!item) return error('Item niet gevonden', 404);

  const body = await readJson(request);
  const admin = isAdmin(request, env);

  // Wie op een openstaand verzoek staat (ook als gezamenlijke aanvrager, zie
  // includesRequester/mergeRequesters in lib/db.js) mag het zelf intrekken of
  // het aantal bijstellen. Dat is geen echte authenticatie, maar het scheelt
  // de besteller elke misklik van een collega.
  const owner =
    item.status === 'open' &&
    typeof body.requester === 'string' &&
    includesRequester(item.requester, body.requester);

  if (body.quantity !== undefined) {
    if (!admin && !owner) return error('Geen rechten om dit aantal te wijzigen', 403);
    const ok = await updateQuantity(env.DB, params.id, body.quantity);
    if (!ok) return error('Aantal kon niet worden gewijzigd', 409);
    return json({ item: await getItem(env.DB, params.id) });
  }

  const status = body.status;
  if (!STATUSES.includes(status)) return error('Onbekende status', 400);

  // Alleen zelf intrekken (status 'deleted') mag zonder admincode, en alleen door
  // de eigenaar van een open verzoek. Afwijzen (status 'rejected') is uitsluitend
  // aan de beheerder.
  const selfWithdrawal = owner && status === 'deleted';
  if (!admin && !selfWithdrawal) return error('Admincode vereist', 403);

  const reason =
    status === 'rejected' && typeof body.reason === 'string'
      ? body.reason.trim().slice(0, 300)
      : null;

  const ok = await setStatus(env.DB, params.id, status, reason);
  if (!ok) return error('Status kon niet worden gewijzigd', 409);

  return json({ item: await getItem(env.DB, params.id) });
}

export async function onRequestDelete({ request, env, params }) {
  if (!isAdmin(request, env)) return error('Admincode vereist', 403);

  const ok = await hardDelete(env.DB, params.id);
  if (!ok) return error('Item niet gevonden', 404);

  return json({ ok: true });
}
