// Toegangspoort voor álle routes, inclusief de statische pagina zelf.
//
// Draait vóór elk request. Zonder een IP dat op de whitelist staat, komt er niets
// door: geen HTML, geen API, geen afbeeldingen.

import { checkIp } from '../lib/auth.js';
import { escapeHtml } from '../lib/http.js';

export async function onRequest(context) {
  const { request, env, next } = context;

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { allowed, reason } = checkIp(ip, env.ALLOWED_IPS);
  if (allowed) return next();

  const isApiCall = new URL(request.url).pathname.startsWith('/api/');
  if (isApiCall) {
    return new Response(
      JSON.stringify({ error: 'Geen toegang vanaf dit IP-adres', ip, reason }),
      { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  return new Response(denyPage(ip, reason), {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function denyPage(ip, reason) {
  const unconfigured = reason === 'unconfigured';

  const heading = unconfigured ? 'Nog niet ingesteld' : 'Geen toegang';
  const body = unconfigured
    ? `<p>De omgevingsvariabele <code>ALLOWED_IPS</code> is niet ingesteld, dus er is nog
       niemand toegelaten. Zet hem in de Cloudflare-dashboard onder
       <em>Settings &rarr; Variables and Secrets</em> en deploy daarna opnieuw.</p>`
    : `<p>Deze tool is alleen bereikbaar vanaf het kantoornetwerk. Stuur het onderstaande
       adres door aan de beheerder om toegang te krijgen.</p>`;

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Geen toegang &middot; Boodschappen</title>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<style>
  :root { --brand: #256176; --ink: #10242c; --muted: #5a7280; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 1.5rem; background: #f4f7f8; color: var(--ink);
    font-family: 'Google Sans', system-ui, sans-serif; line-height: 1.6;
  }
  .card {
    max-width: 34rem; width: 100%; background: #fff; border-radius: 14px; padding: 2.5rem;
    box-shadow: 0 2px 20px rgba(16, 36, 44, 0.1);
  }
  h1 { margin: 0 0 1rem; font-size: 1.5rem; color: var(--brand); }
  p { margin: 0 0 1rem; color: var(--muted); }
  code { background: #eef3f5; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
  .ip-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 0.35rem; }
  .ip { font-family: ui-monospace, monospace; font-size: 1.15rem; color: #fff; background: #000;
        padding: 0.7rem 1rem; border-radius: 8px; word-break: break-all; }
</style>
</head>
<body>
  <main class="card">
    <h1>${heading}</h1>
    ${body}
    <div class="ip-label">Jouw IP-adres</div>
    <div class="ip">${escapeHtml(ip || 'onbekend')}</div>
  </main>
</body>
</html>`;
}
