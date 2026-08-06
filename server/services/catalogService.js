function resolveCategoryOrder(products, requestedOrder) {
  if (Array.isArray(requestedOrder) && requestedOrder.length) return requestedOrder;

  const seen = new Set();
  const order = [];
  products
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .forEach((p) => {
      if (!seen.has(p.category)) {
        seen.add(p.category);
        order.push(p.category);
      }
    });
  return order;
}

function buildSnapshot(products, categoryOrder) {
  const order = resolveCategoryOrder(products, categoryOrder);
  return order.map((category) => ({
    category,
    products: products
      .filter((p) => p.category === category)
      .sort((a, b) => a.display_order - b.display_order)
      .map((p) => ({
        id: p.id,
        productCode: p.product_code,
        name: p.name,
        brand: p.brand,
        imageUrl: p.image_url,
        croppedImageUrl: p.cropped_image_url,
        imageZoom: Number(p.image_zoom),
        imageOffsetX: Number(p.image_offset_x),
        imageOffsetY: Number(p.image_offset_y),
        originalPrice: p.original_price,
        salePrice: p.sale_price,
        composition: p.composition,
        packaging: p.packaging,
        origin: p.origin,
        taxType: p.tax_type,
        features: p.features,
        description: p.description,
        shippingInfo: p.shipping_info,
        promoBadge: p.promo_badge,
      })),
  }));
}

// catalogs.product_snapshot is a materialized copy of the products table,
// built once at catalog create/save time (createCatalog/updateCatalog) -
// deliberate, so a catalog's content stays stable even if products are
// edited later. But nothing re-ran that build step when a product itself
// changed (reordered, code/name/price edited, deleted, bulk-uploaded), so
// an admin editing a product saw the live catalog keep showing the old
// data indefinitely, with no obvious way to force a refresh short of
// re-opening and re-saving the catalog's own edit form. Call this after
// any product mutation to keep every catalog's snapshot in sync
// automatically - every catalog is created from the *entire* products
// table today (no admin UI ever passes a specific productIds subset), so
// "refresh" here just means "rebuild from the current products table,
// keeping each catalog's own saved category order."
async function refreshCatalogSnapshots(dbClient) {
  const { rows: products } = await dbClient.query('SELECT * FROM products');
  const { rows: catalogs } = await dbClient.query('SELECT id, category_order FROM catalogs');
  for (const catalog of catalogs) {
    const resolvedOrder = resolveCategoryOrder(products, catalog.category_order);
    const snapshot = buildSnapshot(products, resolvedOrder);
    // eslint-disable-next-line no-await-in-loop
    await dbClient.query(
      'UPDATE catalogs SET category_order=$1, product_snapshot=$2, updated_at=now() WHERE id=$3',
      [JSON.stringify(resolvedOrder), JSON.stringify(snapshot), catalog.id]
    );
  }
}

function toViewModel(catalogRow) {
  return {
    id: catalogRow.id,
    seasonName: catalogRow.season_name,
    mainTitle: catalogRow.main_title,
    companyLogoUrl: catalogRow.company_logo_url,
    coverImageUrl: catalogRow.cover_image_url,
    backCoverImageUrl: catalogRow.back_cover_image_url,
    showPrice: catalogRow.show_price,
    clientName: catalogRow.client_name,
    clientLogoUrl: catalogRow.client_logo_url,
    categories: catalogRow.product_snapshot,
    pageLayout: catalogRow.page_layout || {},
    maxZoom: Number(catalogRow.max_zoom),
    createdAt: catalogRow.created_at,
  };
}

module.exports = { resolveCategoryOrder, buildSnapshot, toViewModel, refreshCatalogSnapshots };
