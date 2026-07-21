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

function toViewModel(catalogRow) {
  return {
    id: catalogRow.id,
    seasonName: catalogRow.season_name,
    mainTitle: catalogRow.main_title,
    companyLogoUrl: catalogRow.company_logo_url,
    coverImageUrl: catalogRow.cover_image_url,
    showPrice: catalogRow.show_price,
    clientName: catalogRow.client_name,
    clientLogoUrl: catalogRow.client_logo_url,
    categories: catalogRow.product_snapshot,
    createdAt: catalogRow.created_at,
  };
}

module.exports = { resolveCategoryOrder, buildSnapshot, toViewModel };
