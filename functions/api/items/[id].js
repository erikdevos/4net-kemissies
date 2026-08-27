import { getItem, setStatus, hardDelete, updateQuantity } from '../../../lib/db.js';
import { isAdmin } from '../../../lib/auth.js';
import { json, error, readJson } from '../../../lib/http.js';

const STATUSES = ['open', 'ordered', 'deleted'];

export async function onRequestPatch({ request, env, params }) {
  const item = await getItem(env.DB, params.id);
  if (!item) return error('Item niet gevonden', 404);

  const body = await readJson(request);
  const admin = isAdmin(request, env);

  // Wie een openstaand verzoek op eigen naam heeft staan, mag het zelf intrekken
  // of het aantal bijstellen. Dat is geen echte authenticatie, maar het scheelt
  // de besteller elke misklik van een collega.
  const owner =
    item.status === 'open' &&
    typeof body.requester === 'string' &&
    body.requester.trim().toLowerCase() === (item.requester || '').toLowerCase();

  if (body.quantity !== undefined) {
    if (!admin && !owner) return error('Geen rechten om dit aantal te wijzigen', 403);
    const ok = await updateQuantity(env.DB, params.id, body.quantity);
    if (!ok) return error('Aantal kon niet worden gewijzigd', 409);
    return json({ item: await getItem(env.DB, params.id) });
  }

  const status = body.status;
  if (!STATUSES.includes(status)) return error('Onbekende status', 400);

  // Alles behalve je eigen verzoek intrekken vereist de admincode.
  const selfWithdrawal = owner && status === 'deleted';
  if (!admin && !selfWithdrawal) return error('Admincode vereist', 403);

  const ok = await setStatus(env.DB, params.id, status);
  if (!ok) return error('Status kon niet worden gewijzigd', 409);

  return json({ item: await getItem(env.DB, params.id) });
}

export async function onRequestDelete({ request, env, params }) {
  if (!isAdmin(request, env)) return error('Admincode vereist', 403);

  const ok = await hardDelete(env.DB, params.id);
  if (!ok) return error('Item niet gevonden', 404);

  return json({ ok: true });
}
