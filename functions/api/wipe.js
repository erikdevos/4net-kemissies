import { wipeAll } from '../../lib/db.js';
import { isAdmin } from '../../lib/auth.js';
import { json, error, readJson } from '../../lib/http.js';

const CONFIRM_PHRASE = 'VERWIJDER ALLES';

// Volledige reset, onomkeerbaar. Bewust een aparte route met een eigen
// bevestigingszin in de body - naast de admincode - zodat dit nooit per ongeluk
// via een generieke actie geraakt kan worden.
export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return error('Admincode vereist', 403);

  const body = await readJson(request);
  if (body.confirm !== CONFIRM_PHRASE) {
    return error('Bevestiging klopt niet', 400);
  }

  const deleted = await wipeAll(env.DB);
  return json({ deleted });
}
