const pool = require('../config/db');
const { buildSnapshot, resolveCategoryOrder, toViewModel } = require('../services/catalogService');

async function listCatalogs(req, res) {
  const { rows } = await pool.query(
    `SELECT id, main_title, season_name, client_name, show_price, created_at
     FROM catalogs ORDER BY created_at DESC`
  );
  res.json({ catalogs: rows });
}

async function getCatalog(req, res) {
  const { rows } = await pool.query('SELECT * FROM catalogs WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: '카탈로그를 찾을 수 없습니다.' });
  res.json({ catalog: toViewModel(rows[0]) });
}

async function createCatalog(req, res) {
  const {
    seasonName,
    mainTitle,
    companyLogoUrl,
    coverImageUrl,
    showPrice = true,
    clientName,
    clientLogoUrl,
    categoryOrder,
    productIds,
  } = req.body;

  if (!mainTitle) {
    return res.status(400).json({ error: '메인 타이틀은 필수입니다.' });
  }

  let productQuery = 'SELECT * FROM products';
  const params = [];
  if (Array.isArray(productIds) && productIds.length) {
    params.push(productIds);
    productQuery += ' WHERE id = ANY($1::int[])';
  }
  const { rows: products } = await pool.query(productQuery, params);

  if (!products.length) {
    return res.status(400).json({ error: '카탈로그에 포함할 상품이 없습니다.' });
  }

  const resolvedOrder = resolveCategoryOrder(products, categoryOrder);
  const snapshot = buildSnapshot(products, resolvedOrder);

  const { rows } = await pool.query(
    `INSERT INTO catalogs
      (season_name, main_title, company_logo_url, cover_image_url, show_price, client_name, client_logo_url, category_order, product_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      seasonName || null,
      mainTitle,
      companyLogoUrl || null,
      coverImageUrl || null,
      Boolean(showPrice),
      clientName || null,
      clientLogoUrl || null,
      JSON.stringify(resolvedOrder),
      JSON.stringify(snapshot),
    ]
  );
  res.status(201).json({ catalog: toViewModel(rows[0]) });
}

async function deleteCatalog(req, res) {
  const { rowCount } = await pool.query('DELETE FROM catalogs WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: '카탈로그를 찾을 수 없습니다.' });
  res.status(204).end();
}

module.exports = { listCatalogs, getCatalog, createCatalog, deleteCatalog };
