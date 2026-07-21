const pool = require('../config/db');
const { buildTemplateBuffer, parseWorkbookBuffer } = require('../services/excelService');
const { validateRows } = require('../services/validationService');
const { buildProductExportWorkbook, buildExportFilename, buildExportFilenameAscii } = require('../services/exportService');

function buildFilterClause({ search, category, minPrice, maxPrice }) {
  const clauses = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(name ILIKE $${params.length} OR product_code ILIKE $${params.length} OR category ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    clauses.push(`category = $${params.length}`);
  }
  if (minPrice !== undefined && minPrice !== null && minPrice !== '') {
    params.push(Number(minPrice));
    clauses.push(`sale_price >= $${params.length}`);
  }
  if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
    params.push(Number(maxPrice));
    clauses.push(`sale_price <= $${params.length}`);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

async function listProducts(req, res) {
  const { search, category, minPrice, maxPrice } = req.query;
  const { where, params } = buildFilterClause({ search, category, minPrice, maxPrice });

  const { rows } = await pool.query(
    `SELECT * FROM products ${where} ORDER BY category, display_order, id`,
    params
  );
  res.json({ products: rows });
}

async function getProduct(req, res) {
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
  res.json({ product: rows[0] });
}

async function createProduct(req, res) {
  const { validRows, errors } = validateRows([req.body]);
  if (errors.length) return res.status(400).json({ errors });
  const p = validRows[0];
  try {
    const { rows } = await pool.query(
      `INSERT INTO products
        (display_order, category, product_code, name, brand, image_url, original_price, sale_price,
         composition, packaging, origin, tax_type, features, description, shipping_info, promo_badge)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [p.display_order, p.category, p.product_code, p.name, p.brand, p.image_url, p.original_price, p.sale_price,
        p.composition, p.packaging, p.origin, p.tax_type, p.features, p.description, p.shipping_info, p.promo_badge]
    );
    res.status(201).json({ product: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ errors: [{ field: '상품코드', message: '이미 존재하는 상품코드입니다.' }] });
    }
    throw err;
  }
}

async function updateProduct(req, res) {
  const { validRows, errors } = validateRows([req.body]);
  if (errors.length) return res.status(400).json({ errors });
  const p = validRows[0];
  const { rows } = await pool.query(
    `UPDATE products SET
      display_order=$1, category=$2, product_code=$3, name=$4, brand=$5, image_url=$6,
      original_price=$7, sale_price=$8, composition=$9, packaging=$10, origin=$11, tax_type=$12,
      features=$13, description=$14, shipping_info=$15, promo_badge=$16, updated_at=now()
     WHERE id=$17 RETURNING *`,
    [p.display_order, p.category, p.product_code, p.name, p.brand, p.image_url, p.original_price, p.sale_price,
      p.composition, p.packaging, p.origin, p.tax_type, p.features, p.description, p.shipping_info, p.promo_badge, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
  res.json({ product: rows[0] });
}

async function deleteProduct(req, res) {
  const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
  res.status(204).end();
}

async function downloadTemplate(req, res) {
  const buffer = await buildTemplateBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product-upload-template.xlsx"');
  res.send(buffer);
}

async function exportProducts(req, res) {
  const { search, category, minPrice, maxPrice } = req.query;
  const isFiltered = Boolean(search || category || minPrice || maxPrice);
  const { where, params } = buildFilterClause({ search, category, minPrice, maxPrice });

  const { rows } = await pool.query(
    `SELECT * FROM products ${where} ORDER BY category, display_order, id`,
    params
  );

  const buffer = await buildProductExportWorkbook(rows);
  const filename = buildExportFilename(isFiltered);
  const asciiFilename = buildExportFilenameAscii(isFiltered);
  const encodedFilename = encodeURIComponent(filename);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
  );
  res.send(buffer);
}

async function uploadProducts(req, res) {
  if (!req.file) return res.status(400).json({ error: '업로드할 엑셀 파일이 없습니다.' });

  let rows;
  try {
    rows = await parseWorkbookBuffer(req.file.buffer);
  } catch {
    return res.status(400).json({ error: '엑셀 파일을 읽을 수 없습니다. 양식을 확인해주세요.' });
  }

  if (!rows.length) {
    return res.status(400).json({ error: '엑셀 파일에 데이터가 없습니다.' });
  }

  const { validRows, errors } = validateRows(rows);
  if (errors.length) {
    return res.status(400).json({ errors, validCount: validRows.length });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    let updated = 0;
    for (const p of validRows) {
      const { rows: existing } = await client.query('SELECT id FROM products WHERE product_code = $1', [p.product_code]);
      if (existing.length) {
        await client.query(
          `UPDATE products SET
            display_order=$1, category=$2, name=$3, brand=$4, image_url=$5,
            original_price=$6, sale_price=$7, composition=$8, packaging=$9, origin=$10, tax_type=$11,
            features=$12, description=$13, shipping_info=$14, promo_badge=$15, updated_at=now()
           WHERE product_code=$16`,
          [p.display_order, p.category, p.name, p.brand, p.image_url, p.original_price, p.sale_price,
            p.composition, p.packaging, p.origin, p.tax_type, p.features, p.description, p.shipping_info, p.promo_badge, p.product_code]
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO products
            (display_order, category, product_code, name, brand, image_url, original_price, sale_price,
             composition, packaging, origin, tax_type, features, description, shipping_info, promo_badge)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [p.display_order, p.category, p.product_code, p.name, p.brand, p.image_url, p.original_price, p.sale_price,
            p.composition, p.packaging, p.origin, p.tax_type, p.features, p.description, p.shipping_info, p.promo_badge]
        );
        inserted += 1;
      }
    }
    await client.query('COMMIT');
    res.json({ inserted, updated, total: validRows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  downloadTemplate,
  exportProducts,
  uploadProducts,
};
