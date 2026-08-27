-- Boodschappentool - D1 schema
-- Plak dit eenmalig in de Console-tab van je D1-database en voer het uit.

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  ordered_at  TEXT,
  deleted_at  TEXT,
  requester   TEXT NOT NULL,
  product_id  INTEGER,
  title       TEXT NOT NULL,
  brand       TEXT,
  unit_size   TEXT,
  image_url   TEXT,
  product_url TEXT,
  price       REAL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_items_status  ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_product ON items(product_id);
