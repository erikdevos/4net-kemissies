import { orderAllOpen } from '../../lib/db.js';
import { isAdmin } from '../../lib/auth.js';
import { json, error } from '../../lib/http.js';

// De hele ronde in één klik op besteld zetten. Dat is de echte workflow: je
// bestelt geen los item, je bestelt de lijst.
export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return error('Admincode vereist', 403);

  const count = await orderAllOpen(env.DB);
  return json({ ordered: count });
}
