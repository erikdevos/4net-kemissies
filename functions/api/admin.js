import { isAdmin } from '../../lib/auth.js';
import { json, error } from '../../lib/http.js';

// Controleert de admincode zonder iets te wijzigen, zodat de inlogknop meteen
// kan zeggen of de code klopt.
export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return error('Ongeldige admincode', 403);
  return json({ ok: true });
}
