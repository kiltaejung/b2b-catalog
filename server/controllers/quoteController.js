const pool = require('../config/db');

async function createQuote(req, res) {
  const { catalogId, customerCompany, customerName, customerContact, items } = req.body;

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: '견적에 담긴 상품이 없습니다.' });
  }

  const productIds = items.map((item) => item.productId);
  const { rows: products } = await pool.query('SELECT * FROM products WHERE id = ANY($1::int[])', [productIds]);
  const productMap = new Map(products.map((p) => [p.id, p]));

  const resolvedItems = [];
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) continue;
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Number(product.sale_price);
    resolvedItems.push({
      productId: product.id,
      productCode: product.product_code,
      productName: product.name,
      unitPrice,
      quantity,
      subtotal: unitPrice * quantity,
    });
  }

  if (!resolvedItems.length) {
    return res.status(400).json({ error: '유효한 상품이 없습니다.' });
  }

  const totalAmount = resolvedItems.reduce((sum, item) => sum + item.subtotal, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: quoteRows } = await client.query(
      `INSERT INTO quotes (catalog_id, customer_company, customer_name, customer_contact, total_amount)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [catalogId || null, customerCompany || null, customerName || null, customerContact || null, totalAmount]
    );
    const quote = quoteRows[0];

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO quote_items (quote_id, product_id, product_code, product_name, unit_price, quantity, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [quote.id, item.productId, item.productCode, item.productName, item.unitPrice, item.quantity, item.subtotal]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ quote: { ...quote, items: resolvedItems } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listQuotes(req, res) {
  const { rows } = await pool.query(
    `SELECT id, catalog_id, customer_company, customer_name, customer_contact, total_amount, created_at
     FROM quotes ORDER BY created_at DESC`
  );
  res.json({ quotes: rows });
}

async function getQuote(req, res) {
  const { rows: quoteRows } = await pool.query('SELECT * FROM quotes WHERE id = $1', [req.params.id]);
  if (!quoteRows.length) return res.status(404).json({ error: '견적서를 찾을 수 없습니다.' });
  const { rows: items } = await pool.query(
    `SELECT qi.*, p.image_url AS product_image_url
     FROM quote_items qi
     LEFT JOIN products p ON p.id = qi.product_id
     WHERE qi.quote_id = $1`,
    [req.params.id]
  );
  res.json({ quote: { ...quoteRows[0], items } });
}

module.exports = { createQuote, listQuotes, getQuote };
