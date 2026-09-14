// D1-queries. Eén tabel `items`; zie schema.sql.

const MAX_QUANTITY = 10;

const SELECT_FIELDS = `
  id, created_at, ordered_at, requester, product_id, title, brand,
  unit_size, image_url, product_url, price, quantity, note, status, reject_reason
`;

export function rowToItem(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    orderedAt: row.ordered_at,
    requester: row.requester,
    productId: row.product_id,
    title: row.title,
    brand: row.brand,
    unitSize: row.unit_size,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    price: row.price,
    quantity: row.quantity,
    note: row.note,
    status: row.status,
    rejectReason: row.reject_reason,
  };
}

export async function listItems(db, status, { maxAgeDays } = {}) {
  // Open verzoeken oplopend op tijd: de lijst leest als de volgorde waarin
  // mensen iets vroegen. Bestelde items juist aflopend: recentste ronde bovenaan.
  // Afgewezen items ook aflopend: meest recente afwijzing bovenaan.
  const order =
    status === 'open'
      ? 'created_at ASC'
      : status === 'deleted' || status === 'rejected'
        ? 'deleted_at DESC, created_at DESC'
        : 'ordered_at DESC, created_at DESC';

  // maxAgeDays verbergt oudere items uit dit overzicht zonder ze te verwijderen:
  // stats.js (itemLog) leest los van deze functie en toont wel de volledige historie.
  let query = `SELECT ${SELECT_FIELDS} FROM items WHERE status = ?`;
  const params = [status];
  if (maxAgeDays) {
    query += ` AND datetime(deleted_at) >= datetime('now', ?)`;
    params.push(`-${maxAgeDays} days`);
  }
  query += ` ORDER BY ${order}`;

  const { results } = await db.prepare(query).bind(...params).all();
  return (results || []).map(rowToItem);
}

export async function getItem(db, id) {
  const row = await db.prepare(`SELECT ${SELECT_FIELDS} FROM items WHERE id = ?`).bind(id).first();
  return row ? rowToItem(row) : null;
}

/**
 * Voegt een verzoek toe.
 *
 * Er wordt uitsluitend binnen de OPEN verzoeken op dubbelen gecontroleerd, nooit
 * tegen bestelde of verwijderde items. Dat is precies omgekeerd aan de oude opzet,
 * waarin een product dat vorige week besteld was deze week geweigerd werd.
 *
 * Vraagt dezelfde persoon hetzelfde product nog eens aan, dan gaat het aantal
 * omhoog. Vraagt iemand anders het aan, dan komt er een eigen regel bij: de
 * besteller wil zien wie wat wil.
 */
export async function addItem(db, data) {
  const quantity = clampQuantity(data.quantity);

  const existing = await db
    .prepare(
      `SELECT ${SELECT_FIELDS} FROM items
       WHERE status = 'open' AND requester = ?
         AND (( ? IS NOT NULL AND product_id = ? ) OR ( ? IS NULL AND lower(title) = lower(?) ))
       LIMIT 1`
    )
    .bind(data.requester, data.productId, data.productId, data.productId, data.title)
    .first();

  if (existing) {
    const merged = Math.min(existing.quantity + quantity, MAX_QUANTITY);
    await db
      .prepare('UPDATE items SET quantity = ?, note = COALESCE(NULLIF(?, \'\'), note) WHERE id = ?')
      .bind(merged, data.note || '', existing.id)
      .run();
    return { item: { ...rowToItem(existing), quantity: merged, note: data.note || existing.note }, merged: true };
  }

  const item = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    requester: data.requester,
    product_id: data.productId ?? null,
    title: data.title,
    brand: data.brand || '',
    unit_size: data.unitSize || '',
    image_url: data.imageUrl || '',
    product_url: data.productUrl || '',
    price: data.price ?? null,
    quantity,
    note: data.note || '',
  };

  await db
    .prepare(
      `INSERT INTO items
        (id, created_at, requester, product_id, title, brand, unit_size,
         image_url, product_url, price, quantity, note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
    )
    .bind(
      item.id, item.created_at, item.requester, item.product_id, item.title,
      item.brand, item.unit_size, item.image_url, item.product_url,
      item.price, item.quantity, item.note
    )
    .run();

  return { item: rowToItem({ ...item, ordered_at: null, status: 'open' }), merged: false };
}

export async function setStatus(db, id, status, reason = null) {
  const now = new Date().toISOString();
  const orderedAt = status === 'ordered' ? now : null;
  // 'deleted' is een eigen intrekking door de aanvrager, 'rejected' een afwijzing
  // door de beheerder (met eventueel een reden) - allebei verlaten de open lijst.
  const deletedAt = status === 'deleted' || status === 'rejected' ? now : null;
  const rejectReason = status === 'rejected' ? reason : null;

  const result = await db
    .prepare('UPDATE items SET status = ?, ordered_at = ?, deleted_at = ?, reject_reason = ? WHERE id = ?')
    .bind(status, orderedAt, deletedAt, rejectReason, id)
    .run();

  return result.meta.changes > 0;
}

export async function updateQuantity(db, id, quantity) {
  const result = await db
    .prepare("UPDATE items SET quantity = ? WHERE id = ? AND status = 'open'")
    .bind(clampQuantity(quantity), id)
    .run();
  return result.meta.changes > 0;
}

export async function hardDelete(db, id) {
  const result = await db.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

export async function orderAllOpen(db) {
  const now = new Date().toISOString();
  const result = await db
    .prepare("UPDATE items SET status = 'ordered', ordered_at = ? WHERE status = 'open'")
    .bind(now)
    .run();
  return result.meta.changes;
}

/**
 * "Vaker besteld" is geen opgeslagen bibliotheek maar een afgeleide van de echte
 * bestelhistorie: groepeer alles wat besteld is per product en sorteer op hoe vaak.
 */
export async function frequentProducts(db, limit = 24) {
  const { results } = await db
    .prepare(
      `SELECT product_id AS productId,
              COUNT(*)   AS times,
              MAX(ordered_at) AS lastOrdered,
              title, brand, unit_size AS unitSize,
              image_url AS imageUrl, product_url AS productUrl, price
       FROM items
       WHERE status = 'ordered' AND product_id IS NOT NULL
       GROUP BY product_id
       ORDER BY times DESC, lastOrdered DESC
       LIMIT ?`
    )
    .bind(limit)
    .all();
  return results || [];
}

/**
 * Alle mensen die ooit een verzoek hebben ingediend, met hun aantal - voor de
 * personenkeuze op de statistiekenpagina. Alleen wie echt iets aanvroeg staat
 * erin, dus geen losstaande lijst die uit de pas kan lopen met NAMES in app.js.
 */
export async function listRequesters(db) {
  const { results } = await db
    .prepare(
      `SELECT requester, COUNT(*) AS total FROM items
       GROUP BY requester
       ORDER BY requester COLLATE NOCASE`
    )
    .all();
  return results || [];
}

// Alle verzoeken van één persoon, over alle statussen heen, nieuwste eerst.
export async function itemLog(db, requester, limit = 200) {
  const { results } = await db
    .prepare(
      `SELECT ${SELECT_FIELDS} FROM items
       WHERE requester = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(requester, limit)
    .all();
  return (results || []).map(rowToItem);
}

// Top van wat iemand het vaakst besteld kreeg (dus status 'ordered'), duplicaten
// samengevoegd op product.
export async function topProductsByRequester(db, requester, limit = 10) {
  const { results } = await db
    .prepare(
      `SELECT product_id AS productId, title, brand, unit_size AS unitSize,
              image_url AS imageUrl, product_url AS productUrl, price,
              SUM(quantity) AS totalQuantity, COUNT(*) AS times
       FROM items
       WHERE requester = ? AND status = 'ordered'
       GROUP BY COALESCE(product_id, lower(title))
       ORDER BY totalQuantity DESC, times DESC
       LIMIT ?`
    )
    .bind(requester, limit)
    .all();
  return results || [];
}

function clampQuantity(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QUANTITY);
}

export { MAX_QUANTITY };
