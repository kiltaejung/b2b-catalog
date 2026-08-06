const pool = require('../config/db');
const { buildTemplateBuffer, parseWorkbookBuffer } = require('../services/excelService');
const { validateRows } = require('../services/validationService');
const { buildProductExportWorkbook, buildExportFilename, buildExportFilenameAscii } = require('../services/exportService');
const { autoCropProductImage, cropBuffer } = require('../services/imageCropService');

// Registration no longer requires an image up front - a row/product with
// neither a URL nor an embedded picture still saves, using this in place of
// image_url (a NOT NULL column) until an admin attaches a real image later
// via the product form's paste-to-upload field.
const PLACEHOLDER_IMAGE_URL = '/assets/no-image.svg';

// Excel row's or admin-pasted image_url is our own /api/uploads/:id URL
// whenever the picture came from the excel cell (embedded) or the product
// form's paste-to-upload field (see resolveEmbeddedImageUrls and
// updateImageAdjust) rather than an external URL - parses the numeric id
// back out so its stored bytes can be read directly.
function parseUploadId(url) {
  const match = typeof url === 'string' ? /^\/api\/uploads\/(\d+)$/.exec(url) : null;
  return match ? Number(match[1]) : null;
}

async function fetchUploadBuffer(dbClient, id) {
  const { rows } = await dbClient.query('SELECT data FROM uploads WHERE id = $1', [id]);
  return rows.length ? rows[0].data : null;
}

// Runs the auto-crop pipeline only when the image actually changed (or is
// new), storing a successful result in the uploads table. Returns the
// cropped_image_url to persist (null if no crop was produced) and whether
// the source image changed (used to decide if manual zoom/pan should reset).
// When embeddedBuffer is given (a picture pasted into the excel cell rather
// than a URL), it's cropped directly instead of being re-fetched over HTTP.
// A plain image_url that's actually our own /api/uploads/:id (pasted via
// the admin product form) is read straight out of the uploads table for the
// same reason: fetchImageBuffer's SSRF guard refuses a self-referencing URL,
// and the bytes are already sitting right there in our own DB.
async function resolveCroppedImage(dbClient, imageUrl, existingRow, embeddedBuffer) {
  const imageChanged = !existingRow || existingRow.image_url !== imageUrl;
  if (!imageChanged) {
    return { croppedImageUrl: existingRow.cropped_image_url, imageChanged: false };
  }

  let buffer = embeddedBuffer || null;
  if (!buffer) {
    const ownUploadId = parseUploadId(imageUrl);
    if (ownUploadId) buffer = await fetchUploadBuffer(dbClient, ownUploadId);
  }

  const result = buffer ? await cropBuffer(buffer) : await autoCropProductImage(imageUrl);
  if (!result) return { croppedImageUrl: null, imageChanged: true };

  const { rows } = await dbClient.query(
    'INSERT INTO uploads (mime_type, data) VALUES ($1, $2) RETURNING id',
    [result.mimeType, result.buffer]
  );
  return { croppedImageUrl: `/api/uploads/${rows[0].id}`, imageChanged: true };
}

// Mints a fresh /api/uploads/:id URL to stand in for image_url on rows
// whose picture was embedded in the excel cell rather than given as a URL.
// Re-uploading the exact same picture (byte-for-byte, checked against the
// existing product's own upload) reuses its existing URL instead of minting
// a new one every time - otherwise image_url would look "changed" on every
// re-upload even when nothing did, needlessly re-cropping and resetting the
// admin's manual zoom/pan on each pass.
async function resolveEmbeddedImageUrls(dbClient, validRows, existingByCode) {
  for (const p of validRows) {
    if (!p.embedded_image) continue;
    const existing = existingByCode.get(p.product_code);
    const existingId = existing ? parseUploadId(existing.image_url) : null;
    const existingBuffer = existingId ? await fetchUploadBuffer(dbClient, existingId) : null;
    if (existingBuffer && Buffer.compare(existingBuffer, p.embedded_image.buffer) === 0) {
      p.image_url = existing.image_url;
      p._embeddedImageUnchanged = true;
      continue;
    }
    const { rows } = await dbClient.query(
      'INSERT INTO uploads (mime_type, data) VALUES ($1, $2) RETURNING id',
      [p.embedded_image.mimeType, p.embedded_image.buffer]
    );
    p.image_url = `/api/uploads/${rows[0].id}`;
  }
}

function buildFilterClause({ search, category, minPrice, maxPrice }) {
  const clauses = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(name ILIKE $${params.length} OR brand ILIKE $${params.length} OR product_code ILIKE $${params.length} OR category ILIKE $${params.length})`);
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
  if (!p.image_url) p.image_url = PLACEHOLDER_IMAGE_URL;
  const { croppedImageUrl } = await resolveCroppedImage(pool, p.image_url, null);
  try {
    const { rows } = await pool.query(
      `INSERT INTO products
        (display_order, category, product_code, name, brand, image_url, original_price, sale_price,
         composition, packaging, origin, tax_type, features, description, shipping_info, promo_badge,
         cropped_image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [p.display_order, p.category, p.product_code, p.name, p.brand, p.image_url, p.original_price, p.sale_price,
        p.composition, p.packaging, p.origin, p.tax_type, p.features, p.description, p.shipping_info, p.promo_badge,
        croppedImageUrl]
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

  const { rows: existingRows } = await pool.query(
    'SELECT image_url, cropped_image_url FROM products WHERE id = $1',
    [req.params.id]
  );
  if (!existingRows.length) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
  if (!p.image_url) p.image_url = PLACEHOLDER_IMAGE_URL;

  const { croppedImageUrl, imageChanged } = await resolveCroppedImage(pool, p.image_url, existingRows[0]);

  const { rows } = await pool.query(
    `UPDATE products SET
      display_order=$1, category=$2, product_code=$3, name=$4, brand=$5, image_url=$6,
      original_price=$7, sale_price=$8, composition=$9, packaging=$10, origin=$11, tax_type=$12,
      features=$13, description=$14, shipping_info=$15, promo_badge=$16, cropped_image_url=$17,
      image_zoom = CASE WHEN $18 THEN 1 ELSE image_zoom END,
      image_offset_x = CASE WHEN $18 THEN 0 ELSE image_offset_x END,
      image_offset_y = CASE WHEN $18 THEN 0 ELSE image_offset_y END,
      updated_at=now()
     WHERE id=$19 RETURNING *`,
    [p.display_order, p.category, p.product_code, p.name, p.brand, p.image_url, p.original_price, p.sale_price,
      p.composition, p.packaging, p.origin, p.tax_type, p.features, p.description, p.shipping_info, p.promo_badge,
      croppedImageUrl, imageChanged, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
  res.json({ product: rows[0] });
}

const IMAGE_ZOOM_MIN = 1;
const IMAGE_ZOOM_MAX = 3;
const IMAGE_OFFSET_MAX = 50;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function updateImageAdjust(req, res) {
  const zoom = Number(req.body.zoom);
  const offsetX = Number(req.body.offsetX);
  const offsetY = Number(req.body.offsetY);
  if (!Number.isFinite(zoom) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    return res.status(400).json({ error: '유효하지 않은 이미지 조정 값입니다.' });
  }

  const { rows } = await pool.query(
    `UPDATE products SET image_zoom=$1, image_offset_x=$2, image_offset_y=$3, updated_at=now()
     WHERE id=$4 RETURNING *`,
    [clamp(zoom, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX), clamp(offsetX, -IMAGE_OFFSET_MAX, IMAGE_OFFSET_MAX),
      clamp(offsetY, -IMAGE_OFFSET_MAX, IMAGE_OFFSET_MAX), req.params.id]
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
  const { search, category, minPrice, maxPrice, title } = req.query;
  const isFiltered = Boolean(search || category || minPrice || maxPrice);
  const { where, params } = buildFilterClause({ search, category, minPrice, maxPrice });

  const { rows } = await pool.query(
    `SELECT * FROM products ${where} ORDER BY category, display_order, id`,
    params
  );

  const buffer = await buildProductExportWorkbook(rows, title);
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

  // Resolve auto-crop results before opening the write transaction, since
  // each one may involve a network fetch — we don't want that holding a DB
  // connection/transaction open. Existing rows are looked up up front so
  // unchanged images are skipped (not re-cropped) on every re-upload.
  const { rows: existingRows } = await pool.query(
    'SELECT product_code, image_url, cropped_image_url FROM products WHERE product_code = ANY($1)',
    [validRows.map((p) => p.product_code)]
  );
  const existingByCode = new Map(existingRows.map((r) => [r.product_code, r]));
  await resolveEmbeddedImageUrls(pool, validRows, existingByCode);
  validRows.forEach((p) => {
    if (!p.image_url) p.image_url = PLACEHOLDER_IMAGE_URL;
  });
  const cropResults = new Map();
  for (const p of validRows) {
    const embeddedBuffer = p.embedded_image && !p._embeddedImageUnchanged ? p.embedded_image.buffer : null;
    const { croppedImageUrl, imageChanged } = await resolveCroppedImage(pool, p.image_url, existingByCode.get(p.product_code), embeddedBuffer);
    cropResults.set(p.product_code, { croppedImageUrl, imageChanged });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    let updated = 0;
    for (const p of validRows) {
      const { croppedImageUrl, imageChanged } = cropResults.get(p.product_code);
      const existing = existingByCode.get(p.product_code);
      if (existing) {
        await client.query(
          `UPDATE products SET
            display_order=$1, category=$2, name=$3, brand=$4, image_url=$5,
            original_price=$6, sale_price=$7, composition=$8, packaging=$9, origin=$10, tax_type=$11,
            features=$12, description=$13, shipping_info=$14, promo_badge=$15, cropped_image_url=$16,
            image_zoom = CASE WHEN $17 THEN 1 ELSE image_zoom END,
            image_offset_x = CASE WHEN $17 THEN 0 ELSE image_offset_x END,
            image_offset_y = CASE WHEN $17 THEN 0 ELSE image_offset_y END,
            updated_at=now()
           WHERE product_code=$18`,
          [p.display_order, p.category, p.name, p.brand, p.image_url, p.original_price, p.sale_price,
            p.composition, p.packaging, p.origin, p.tax_type, p.features, p.description, p.shipping_info, p.promo_badge,
            croppedImageUrl, imageChanged, p.product_code]
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO products
            (display_order, category, product_code, name, brand, image_url, original_price, sale_price,
             composition, packaging, origin, tax_type, features, description, shipping_info, promo_badge,
             cropped_image_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [p.display_order, p.category, p.product_code, p.name, p.brand, p.image_url, p.original_price, p.sale_price,
            p.composition, p.packaging, p.origin, p.tax_type, p.features, p.description, p.shipping_info, p.promo_badge,
            croppedImageUrl]
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
  updateImageAdjust,
  deleteProduct,
  downloadTemplate,
  exportProducts,
  uploadProducts,
};
