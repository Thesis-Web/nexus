-- Nexus default-shipped Sales & Finance database.
-- Ships with the product as one of two operational target systems
-- (paired with the warehouse DB in 002_schema.sql under ../warehouse).
--
-- Purpose: realistic small-business shape so the connector can be exercised
-- against meaningful queries — not a sterile lookup table. Row counts are
-- intentionally small (3-5 per table) so the demo answer is human-checkable.
--
-- This script runs ONCE when the docker volume is first created. To rebuild,
-- `docker compose -f infra/docker-compose.dev.yaml down -v` then `up -d`.

-- ─── Reference tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  customer_code        TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  contact_email        TEXT NOT NULL,
  region               TEXT NOT NULL,
  payment_terms_days   INTEGER NOT NULL DEFAULT 30,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendors (
  vendor_code          TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  contact_email        TEXT NOT NULL,
  payment_terms        TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  sku                  TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  unit_price           NUMERIC(12,2) NOT NULL,
  category             TEXT NOT NULL,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Quotes ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotes (
  quote_code           TEXT PRIMARY KEY,
  customer_code        TEXT NOT NULL REFERENCES customers(customer_code),
  status               TEXT NOT NULL CHECK (status IN ('draft','sent','accepted','expired','rejected')),
  subtotal             NUMERIC(14,2) NOT NULL,
  valid_until          DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_lines (
  quote_code           TEXT NOT NULL REFERENCES quotes(quote_code) ON DELETE CASCADE,
  line_no              INTEGER NOT NULL,
  sku                  TEXT NOT NULL REFERENCES products(sku),
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  unit_price           NUMERIC(12,2) NOT NULL,
  PRIMARY KEY (quote_code, line_no)
);

-- ─── Sales orders ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_orders (
  order_code           TEXT PRIMARY KEY,
  customer_code        TEXT NOT NULL REFERENCES customers(customer_code),
  quote_code           TEXT REFERENCES quotes(quote_code),
  status               TEXT NOT NULL CHECK (status IN ('pending','processing','shipped','delivered','cancelled')),
  subtotal             NUMERIC(14,2) NOT NULL,
  ordered_at           TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  order_code           TEXT NOT NULL REFERENCES sales_orders(order_code) ON DELETE CASCADE,
  line_no              INTEGER NOT NULL,
  sku                  TEXT NOT NULL REFERENCES products(sku),
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  unit_price           NUMERIC(12,2) NOT NULL,
  PRIMARY KEY (order_code, line_no)
);

-- ─── Invoices ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoices (
  invoice_code         TEXT PRIMARY KEY,
  order_code           TEXT NOT NULL REFERENCES sales_orders(order_code),
  customer_code        TEXT NOT NULL REFERENCES customers(customer_code),
  status               TEXT NOT NULL CHECK (status IN ('draft','issued','paid','overdue','void')),
  total                NUMERIC(14,2) NOT NULL,
  issued_at            TIMESTAMPTZ NOT NULL,
  due_at               DATE NOT NULL,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Purchase orders ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_orders (
  po_code              TEXT PRIMARY KEY,
  vendor_code          TEXT NOT NULL REFERENCES vendors(vendor_code),
  status               TEXT NOT NULL CHECK (status IN ('draft','submitted','received','closed','cancelled')),
  total                NUMERIC(14,2) NOT NULL,
  ordered_at           TIMESTAMPTZ NOT NULL,
  expected_at          DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  po_code              TEXT NOT NULL REFERENCES purchase_orders(po_code) ON DELETE CASCADE,
  line_no              INTEGER NOT NULL,
  sku                  TEXT NOT NULL REFERENCES products(sku),
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost            NUMERIC(12,2) NOT NULL,
  PRIMARY KEY (po_code, line_no)
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_quotes_customer        ON quotes(customer_code);
CREATE INDEX IF NOT EXISTS idx_quotes_status          ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer  ON sales_orders(customer_code);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status    ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_invoices_status        ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_at        ON invoices(due_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders(vendor_code);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);

-- ─── Seed data ──────────────────────────────────────────────────────────────

INSERT INTO customers (customer_code, name, contact_email, region, payment_terms_days) VALUES
  ('CUST-001', 'Acme Corp',           'orders@acme.example',       'west',    30),
  ('CUST-002', 'Globex Inc',          'purchasing@globex.example', 'east',    45),
  ('CUST-003', 'Initech LLC',         'buyer@initech.example',     'central', 30),
  ('CUST-004', 'Hooli Industries',    'ap@hooli.example',          'west',    60),
  ('CUST-005', 'Stark Manufacturing', 'orders@stark.example',      'east',    30)
ON CONFLICT DO NOTHING;

INSERT INTO vendors (vendor_code, name, contact_email, payment_terms) VALUES
  ('V-100', 'Raw Materials Co',  'sales@rawmat.example',     'net-30'),
  ('V-200', 'PackRight Supply',  'orders@packright.example', 'net-15'),
  ('V-300', 'BoltAndScrew Ltd',  'sales@boltscrew.example',  'net-45')
ON CONFLICT DO NOTHING;

INSERT INTO products (sku, name, unit_price, category) VALUES
  ('WIDGET-A', 'Standard Widget',     12.50,  'components'),
  ('WIDGET-B', 'Premium Widget',      24.99,  'components'),
  ('GADGET-X', 'Mini Gadget',          8.75,  'accessories'),
  ('GADGET-Y', 'Pro Gadget',          45.00,  'accessories'),
  ('SUPPLY-1', 'Packing Tape Roll',    3.25,  'supplies'),
  ('ASSY-100', 'Widget+Gadget Kit',   65.00,  'assemblies')
ON CONFLICT DO NOTHING;

-- Quotes (mix of statuses, some still valid, one expired)
INSERT INTO quotes (quote_code, customer_code, status, subtotal, valid_until, created_at) VALUES
  ('Q-2026-001', 'CUST-001', 'accepted', 625.00,  '2026-05-30', '2026-04-12T09:00:00Z'),
  ('Q-2026-002', 'CUST-002', 'sent',     249.90,  '2026-06-01', '2026-05-01T11:00:00Z'),
  ('Q-2026-003', 'CUST-003', 'expired',  120.00,  '2026-04-30', '2026-03-15T14:00:00Z'),
  ('Q-2026-004', 'CUST-004', 'draft',    900.00,  '2026-06-15', '2026-05-08T10:30:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO quote_lines (quote_code, line_no, sku, quantity, unit_price) VALUES
  ('Q-2026-001', 1, 'WIDGET-A', 30, 12.50),
  ('Q-2026-001', 2, 'WIDGET-B', 10, 24.99),
  ('Q-2026-002', 1, 'WIDGET-B', 10, 24.99),
  ('Q-2026-003', 1, 'GADGET-X', 14,  8.57),
  ('Q-2026-004', 1, 'ASSY-100', 12, 65.00),
  ('Q-2026-004', 2, 'SUPPLY-1', 30,  3.25)
ON CONFLICT DO NOTHING;

-- Sales orders (one shipped, two in flight)
INSERT INTO sales_orders (order_code, customer_code, quote_code, status, subtotal, ordered_at) VALUES
  ('SO-1001', 'CUST-001', 'Q-2026-001', 'shipped',    625.00,  '2026-04-15T10:00:00Z'),
  ('SO-1002', 'CUST-002', NULL,         'pending',    249.90,  '2026-05-01T14:30:00Z'),
  ('SO-1003', 'CUST-003', NULL,         'processing',  87.50,  '2026-05-05T09:15:00Z'),
  ('SO-1004', 'CUST-005', NULL,         'cancelled', 1350.00,  '2026-04-20T16:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO sales_order_lines (order_code, line_no, sku, quantity, unit_price) VALUES
  ('SO-1001', 1, 'WIDGET-A', 30, 12.50),
  ('SO-1001', 2, 'WIDGET-B', 10, 24.99),
  ('SO-1002', 1, 'WIDGET-B', 10, 24.99),
  ('SO-1003', 1, 'GADGET-X', 10,  8.75),
  ('SO-1004', 1, 'GADGET-Y', 30, 45.00)
ON CONFLICT DO NOTHING;

-- Invoices (one paid, one issued and not yet due, one overdue)
INSERT INTO invoices (invoice_code, order_code, customer_code, status, total, issued_at, due_at, paid_at) VALUES
  ('INV-2026-1001', 'SO-1001', 'CUST-001', 'paid',    625.00, '2026-04-16T10:00:00Z', '2026-05-16', '2026-05-08T13:00:00Z'),
  ('INV-2026-1002', 'SO-1002', 'CUST-002', 'issued',  249.90, '2026-05-02T10:00:00Z', '2026-06-16', NULL),
  ('INV-2026-1003', 'SO-1003', 'CUST-003', 'overdue',  87.50, '2026-04-01T10:00:00Z', '2026-05-01', NULL)
ON CONFLICT DO NOTHING;

-- Purchase orders (vendor side)
INSERT INTO purchase_orders (po_code, vendor_code, status, total, ordered_at, expected_at) VALUES
  ('PO-2026-001', 'V-100', 'received',  1500.00, '2026-04-10T09:00:00Z', '2026-04-25'),
  ('PO-2026-002', 'V-200', 'submitted',  450.00, '2026-05-03T11:00:00Z', '2026-05-20'),
  ('PO-2026-003', 'V-300', 'draft',      275.00, '2026-05-08T14:00:00Z', '2026-06-01')
ON CONFLICT DO NOTHING;

INSERT INTO purchase_order_lines (po_code, line_no, sku, quantity, unit_cost) VALUES
  ('PO-2026-001', 1, 'WIDGET-A', 100, 8.00),
  ('PO-2026-001', 2, 'WIDGET-B',  50, 14.00),
  ('PO-2026-002', 1, 'SUPPLY-1', 200, 2.25),
  ('PO-2026-003', 1, 'GADGET-X',  50, 5.50)
ON CONFLICT DO NOTHING;
