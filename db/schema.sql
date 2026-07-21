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
  origin VARCHAR(255),
  features TEXT,
  description TEXT,
  shipping_info TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_display_order ON products (display_order);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  catalog_id INTEGER REFERENCES catalogs(id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  customer_contact VARCHAR(255),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
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
