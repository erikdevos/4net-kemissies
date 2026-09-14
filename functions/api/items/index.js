import { listItems, addItem } from '../../../lib/db.js';
import { json, error, readJson } from '../../../lib/http.js';

const STATUSES = ['open', 'ordered', 'deleted', 'rejected'];

// Afgewezen items ouder dan dit worden hier verborgen (blijven wel bewaard voor
// de statistiekenpagina, zie lib/db.js listItems en itemLog).
const REJECTED_VISIBLE_DAYS = 30;

export async function onRequestGet({ request, env }) {
  const status = new URL(request.url).searchParams.get('status') || 'open';
  if (!STATUSES.includes(status)) return error('Onbekende status', 400);

  const options = status === 'rejected' ? { maxAgeDays: REJECTED_VISIBLE_DAYS } : {};
  const items = await listItems(env.DB, status, options);
  return json({ items });
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);

  const requester = trim(body.requester, 60);
  if (!requester) return error('Kies eerst je naam', 400);

  const title = trim(body.title, 200);
  if (!title) return error('Selecteer eerst een product', 400);

  const { item, merged } = await addItem(env.DB, {
    requester,
    title,
    productId: toNullableInt(body.productId),
    brand: trim(body.brand, 100),
    unitSize: trim(body.unitSize, 60),
    imageUrl: safeUrl(body.imageUrl),
    productUrl: safeUrl(body.productUrl),
    price: toNullableNumber(body.price),
    quantity: body.quantity,
    note: trim(body.note, 200),
  });

  return json({ item, merged }, merged ? 200 : 201);
}

function trim(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function toNullableInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function toNullableNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Alleen http(s) toestaan, zodat er nooit een javascript:-URL in de database belandt.
function safeUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed.slice(0, 500);
}
