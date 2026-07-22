const pool = require('../config/db');
const { buildSnapshot, resolveCategoryOrder, toViewModel } = require('../services/catalogService');

const DEFAULT_MAX_ZOOM = 3;
const MIN_ALLOWED_ZOOM = 1.5;
const MAX_ALLOWED_ZOOM = 6;

function normalizeMaxZoom(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_MAX_ZOOM;
  return Math.min(MAX_ALLOWED_ZOOM, Math.max(MIN_ALLOWED_ZOOM, num));
}

// pageLayout: { [category]: number[] }, each entry a per-page product count.
// Only 4 or 6 are ever allowed per page.
function validatePageLayout(pageLayout) {
  if (pageLayout === undefined || pageLayout === null) return {};
  if (typeof pageLayout !== 'object' || Array.isArray(pageLayout)) {
    throw new Error('상품 노출 수량은 4개 또는 6개만 설정할 수 있습니다.');
  }
  for (const sizes of Object.values(pageLayout)) {
    if (!Array.isArray(sizes) || sizes.some((n) => n !== 4 && n !== 6)) {
      throw new Error('상품 노출 수량은 4개 또는 6개만 설정할 수 있습니다.');
    }
  }
  return pageLayout;
}

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

async function loadSnapshot(categoryOrder, productIds) {
  let productQuery = 'SELECT * FROM products';
  const params = [];
  if (Array.isArray(productIds) && productIds.length) {
    params.push(productIds);
    productQuery += ' WHERE id = ANY($1::int[])';
  }
  const { rows: products } = await pool.query(productQuery, params);
  if (!products.length) return null;

  const resolvedOrder = resolveCategoryOrder(products, categoryOrder);
  return { resolvedOrder, snapshot: buildSnapshot(products, resolvedOrder) };
}

async function createCatalog(req, res) {
  const {
    seasonName,
    mainTitle,
    companyLogoUrl,
    coverImageUrl,
    backCoverImageUrl,
    showPrice = true,
    clientName,
    clientLogoUrl,
    categoryOrder,
    productIds,
    maxZoom,
    pageLayout,
  } = req.body;

  if (!mainTitle) {
    return res.status(400).json({ error: '메인 타이틀은 필수입니다.' });
  }

  let validatedPageLayout;
  try {
    validatedPageLayout = validatePageLayout(pageLayout);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const result = await loadSnapshot(categoryOrder, productIds);
  if (!result) {
    return res.status(400).json({ error: '카탈로그에 포함할 상품이 없습니다.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO catalogs
      (season_name, main_title, company_logo_url, cover_image_url, back_cover_image_url, show_price, client_name, client_logo_url, category_order, product_snapshot, max_zoom, page_layout)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      seasonName || null,
      mainTitle,
      companyLogoUrl || null,
      coverImageUrl || null,
      backCoverImageUrl || null,
      Boolean(showPrice),
      clientName || null,
      clientLogoUrl || null,
      JSON.stringify(result.resolvedOrder),
      JSON.stringify(result.snapshot),
      normalizeMaxZoom(maxZoom),
      JSON.stringify(validatedPageLayout),
    ]
  );
  res.status(201).json({ catalog: toViewModel(rows[0]) });
}

async function updateCatalog(req, res) {
  const {
    seasonName,
    mainTitle,
    companyLogoUrl,
    coverImageUrl,
    backCoverImageUrl,
    showPrice = true,
    clientName,
    clientLogoUrl,
    categoryOrder,
    productIds,
    maxZoom,
    pageLayout,
  } = req.body;

  if (!mainTitle) {
    return res.status(400).json({ error: '메인 타이틀은 필수입니다.' });
  }

  let validatedPageLayout;
  try {
    validatedPageLayout = validatePageLayout(pageLayout);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const result = await loadSnapshot(categoryOrder, productIds);
  if (!result) {
    return res.status(400).json({ error: '카탈로그에 포함할 상품이 없습니다.' });
  }

  const { rows } = await pool.query(
    `UPDATE catalogs SET
      season_name=$1, main_title=$2, company_logo_url=$3, cover_image_url=$4, back_cover_image_url=$5, show_price=$6,
      client_name=$7, client_logo_url=$8, category_order=$9, product_snapshot=$10, max_zoom=$11, page_layout=$12, updated_at=now()
     WHERE id=$13 RETURNING *`,
    [
      seasonName || null,
      mainTitle,
      companyLogoUrl || null,
      coverImageUrl || null,
      backCoverImageUrl || null,
      Boolean(showPrice),
      clientName || null,
      clientLogoUrl || null,
      JSON.stringify(result.resolvedOrder),
      JSON.stringify(result.snapshot),
      normalizeMaxZoom(maxZoom),
      JSON.stringify(validatedPageLayout),
      req.params.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: '카탈로그를 찾을 수 없습니다.' });
  res.json({ catalog: toViewModel(rows[0]) });
}

async function deleteCatalog(req, res) {
  const { rowCount } = await pool.query('DELETE FROM catalogs WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: '카탈로그를 찾을 수 없습니다.' });
  res.status(204).end();
}

module.exports = { listCatalogs, getCatalog, createCatalog, updateCatalog, deleteCatalog };
