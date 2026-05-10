-- Nexus default-shipped Warehouse database.
-- Operationally separate from sales/finance — this is the WMS surface.
-- Demonstrates the connector manifold supporting >1 of the same connector
-- type with different configs and credentials.
--
-- This script runs ONCE when the docker volume is first created. To rebuild,
-- `docker compose -f infra/docker-compose.dev.yaml down -v` then `up -d`.

CREATE TABLE IF NOT EXISTS locations (
  location_code        TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  address              TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('warehouse','store','transit')),
  active               BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventory (
  sku                  TEXT NOT NULL,
  location_code        TEXT NOT NULL REFERENCES locations(location_code),
  quantity_on_hand     INTEGER NOT NULL CHECK (quantity_on_hand >= 0),
  quantity_reserved    INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  reorder_point        INTEGER,
  last_counted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, location_code)
);

CREATE TABLE IF NOT EXISTS shipments (
  shipment_code        TEXT PRIMARY KEY,
  -- order_code references a row in the sales-finance database. We do NOT
  -- enforce it as a FK here — the two databases are intentionally separate
  -- target systems and cross-DB FKs would couple them.
  order_code           TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('pending','picking','packed','shipped','delivered','returned')),
  carrier              TEXT,
  tracking_number      TEXT,
  origin_location      TEXT REFERENCES locations(location_code),
  destination_address  TEXT NOT NULL,
  shipped_at           TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipment_lines (
  shipment_code        TEXT NOT NULL REFERENCES shipments(shipment_code) ON DELETE CASCADE,
  line_no              INTEGER NOT NULL,
  sku                  TEXT NOT NULL,
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  source_location      TEXT REFERENCES locations(location_code),
  PRIMARY KEY (shipment_code, line_no)
);

CREATE INDEX IF NOT EXISTS idx_inventory_sku           ON inventory(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock     ON inventory(sku) WHERE quantity_on_hand <= 50;
CREATE INDEX IF NOT EXISTS idx_shipments_order         ON shipments(order_code);
CREATE INDEX IF NOT EXISTS idx_shipments_status        ON shipments(status);

-- ─── Seed data ──────────────────────────────────────────────────────────────

INSERT INTO locations (location_code, name, address, type) VALUES
  ('WH-WEST', 'Western Distribution Center', '1200 Loading Dock Rd, Fontana CA',  'warehouse'),
  ('WH-EAST', 'Eastern Distribution Center', '450 Pallet Way, Allentown PA',      'warehouse'),
  ('STORE-1', 'Downtown Showroom',            '88 Market St, Portland OR',         'store')
ON CONFLICT DO NOTHING;

-- Inventory across both warehouses + a small store buffer
INSERT INTO inventory (sku, location_code, quantity_on_hand, quantity_reserved, reorder_point) VALUES
  ('WIDGET-A', 'WH-WEST',  500, 30, 100),
  ('WIDGET-A', 'WH-EAST',  300, 10, 100),
  ('WIDGET-B', 'WH-WEST',  200, 10,  50),
  ('GADGET-X', 'WH-EAST', 1000, 80, 200),
  ('GADGET-Y', 'WH-WEST',  150,  0,  50),
  ('SUPPLY-1', 'WH-WEST', 3000, 0,  500),
  ('SUPPLY-1', 'WH-EAST',  800, 0,  200),
  ('ASSY-100', 'WH-WEST',   25,  0,  20),
  ('WIDGET-A', 'STORE-1',   12,  0,  10),
  ('GADGET-X', 'STORE-1',    8,  0,   5)
ON CONFLICT DO NOTHING;

-- Shipments — one delivered, one in flight, one being picked
INSERT INTO shipments (shipment_code, order_code, status, carrier, tracking_number, origin_location, destination_address, shipped_at, delivered_at) VALUES
  ('SHIP-2026-0001', 'SO-1001', 'delivered', 'UPS',   '1Z999AA10123456784', 'WH-WEST', '500 Acme Way, Reno NV',           '2026-04-17T08:30:00Z', '2026-04-19T14:00:00Z'),
  ('SHIP-2026-0002', 'SO-1002', 'shipped',   'FedEx', '794612938174',       'WH-EAST', '12 Globex Pl, Newark NJ',         '2026-05-03T09:00:00Z', NULL),
  ('SHIP-2026-0003', 'SO-1003', 'picking',    NULL,    NULL,                'WH-EAST', '750 Initech Dr, Springfield MO',   NULL,                   NULL)
ON CONFLICT DO NOTHING;

INSERT INTO shipment_lines (shipment_code, line_no, sku, quantity, source_location) VALUES
  ('SHIP-2026-0001', 1, 'WIDGET-A', 30, 'WH-WEST'),
  ('SHIP-2026-0001', 2, 'WIDGET-B', 10, 'WH-WEST'),
  ('SHIP-2026-0002', 1, 'WIDGET-B', 10, 'WH-EAST'),
  ('SHIP-2026-0003', 1, 'GADGET-X', 10, 'WH-EAST')
ON CONFLICT DO NOTHING;
