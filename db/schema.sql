-- B2B Catalog System schema

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  display_order INTEGER NOT NULL DEFAULT 0,
  category VARCHAR(100) NOT NULL,
  product_code VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(255),
  image_url TEXT NOT NULL,
  original_price NUMERIC(12, 2),
  sale_price NUMERIC(12, 2) NOT NULL,
  composition VARCHAR(255) NOT NULL,
  packaging VARCHAR(255),
  origin VARCHAR(255),
  tax_type VARCHAR(20),
  features TEXT,
  description TEXT,
  shipping_info TEXT,
  promo_badge VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_display_order ON products (display_order);

-- Idempotent migrations for databases created before these columns existed.
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_type VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_badge VARCHAR(20);

CREATE TABLE IF NOT EXISTS catalogs (
  id SERIAL PRIMARY KEY,
  season_name VARCHAR(255),
  main_title VARCHAR(255) NOT NULL,
  company_logo_url TEXT,
  cover_image_url TEXT,
  show_price BOOLEAN NOT NULL DEFAULT true,
  client_name VARCHAR(255),
  client_logo_url TEXT,
  category_order JSONB NOT NULL DEFAULT '[]',
  product_snapshot JSONB NOT NULL DEFAULT '[]',
  max_zoom NUMERIC(3, 1) NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent migration for catalogs created before max_zoom existed.
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS max_zoom NUMERIC(3, 1) NOT NULL DEFAULT 3;

-- Idempotent migration for catalogs created before back_cover_image_url existed.
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS back_cover_image_url TEXT;

-- Per-category page layout: { [category]: number[] } — each entry is the
-- configured product count (4 or 6) for that category's Nth grid page.
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS page_layout JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  catalog_id INTEGER REFERENCES catalogs(id) ON DELETE SET NULL,
  customer_company VARCHAR(255),
  customer_name VARCHAR(255),
  customer_contact VARCHAR(255),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent migration for databases created before customer_company existed.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_company VARCHAR(255);

CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  mime_type VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_code VARCHAR(100) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  subtotal NUMERIC(14, 2) NOT NULL
);
