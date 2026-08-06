const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const VALID_TAX_TYPES = ['면세', '과세'];
const VALID_PROMO_BADGES = ['강력추천', '베스트'];

// A site-relative path we minted ourselves - either /api/uploads/:id (the
// admin product form's paste-to-upload field, or a re-saved excel-embedded
// image) or the /assets/no-image.svg placeholder used when a product is
// registered with no image at all. Both are already known-good (content
// validated at upload time, or a real static asset), so they skip the
// absolute-URL/extension checks below that only make sense for a
// manually-typed external URL.
const OWN_SITE_PATH = /^\/(api\/uploads\/\d+|assets\/[\w.-]+)$/;

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasImageExtension(value) {
  const pathname = (() => {
    try {
      return new URL(value).pathname.toLowerCase();
    } catch {
      return value.toLowerCase();
    }
  })();
  return IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

function isValidPrice(value) {
  if (value === undefined || value === null || value === '') return false;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0;
}

/**
 * Validates parsed excel rows against the registration rules in section 4/14
 * of the catalog spec. Returns { validRows, errors } where errors is a list
 * of { row, field, message } describing every problem found, including
 * duplicate product codes within the file itself.
 */
function validateRows(rows, existingCodes = new Set()) {
  const errors = [];
  const seenCodes = new Map();
  const validRows = [];

  rows.forEach((row, index) => {
    // parseWorkbookBuffer stamps the real excel row number onto each row
    // (the header no longer always sits at row 1 - see findHeaderRowNumber);
    // callers that build rows by hand (e.g. the single-product form) don't
    // set this, so fall back to the old fixed-header assumption for them.
    const rowNumber = row._rowNumber || index + 2;
    const rowErrors = [];

    if (row.display_order === undefined || row.display_order === '' || Number.isNaN(Number(row.display_order))) {
      rowErrors.push({ row: rowNumber, field: '노출순서', message: '노출순서가 없거나 숫자가 아닙니다.' });
    }
    if (!row.category) {
      rowErrors.push({ row: rowNumber, field: '카테고리', message: '카테고리는 필수입니다.' });
    }
    if (!row.product_code) {
      rowErrors.push({ row: rowNumber, field: '상품코드', message: '상품코드는 필수입니다.' });
    }
    if (!row.name) {
      rowErrors.push({ row: rowNumber, field: '상품명', message: '상품명은 필수입니다.' });
    }
    if (!row.composition) {
      rowErrors.push({ row: rowNumber, field: '상품구성', message: '상품구성은 필수입니다.' });
    }

    // A row can supply its representative image either as a URL in this
    // column, or as a picture pasted/inserted directly into the cell (see
    // excelService's extractRowImages) - an embedded picture always wins
    // when both are present, so the URL column isn't even format-checked
    // in that case. The image itself is optional at registration time - a
    // row with neither still registers (with a placeholder image), so the
    // image can be attached later from the admin product form instead.
    const embeddedImage = row._embeddedImage || null;
    if (row.image_url && !embeddedImage && !OWN_SITE_PATH.test(row.image_url)) {
      if (!isValidUrl(row.image_url)) {
        rowErrors.push({ row: rowNumber, field: '대표이미지 URL', message: '유효한 URL 형식이 아닙니다.' });
      } else if (!hasImageExtension(row.image_url)) {
        rowErrors.push({ row: rowNumber, field: '대표이미지 URL', message: 'JPG/PNG/WEBP 형식만 지원합니다.' });
      }
    }

    if (!isValidPrice(row.sale_price)) {
      rowErrors.push({ row: rowNumber, field: '판매가', message: '판매가는 필수이며 0 이상의 숫자여야 합니다.' });
    }
    if (row.original_price !== undefined && row.original_price !== '' && !isValidPrice(row.original_price)) {
      rowErrors.push({ row: rowNumber, field: '정상가', message: '정상가는 0 이상의 숫자여야 합니다.' });
    }

    if (row.product_code) {
      if (seenCodes.has(row.product_code)) {
        rowErrors.push({ row: rowNumber, field: '상품코드', message: `상품코드가 파일 내에서 중복되었습니다 (${seenCodes.get(row.product_code)}행과 중복).` });
      } else {
        seenCodes.set(row.product_code, rowNumber);
      }
    }

    const taxType = row.tax_type ? String(row.tax_type).trim() : '';
    if (taxType && !VALID_TAX_TYPES.includes(taxType)) {
      rowErrors.push({ row: rowNumber, field: '면세/과세', message: '면세 또는 과세 중 하나여야 합니다.' });
    }

    const promoBadge = row.promo_badge ? String(row.promo_badge).trim() : '';
    if (promoBadge && promoBadge !== '미선택' && !VALID_PROMO_BADGES.includes(promoBadge)) {
      rowErrors.push({ row: rowNumber, field: '홍보특징', message: '강력추천, 베스트, 미선택 중 하나여야 합니다.' });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push({
        display_order: Number(row.display_order),
        category: String(row.category).trim(),
        product_code: String(row.product_code).trim(),
        name: String(row.name).trim(),
        brand: row.brand ? String(row.brand).trim() : null,
        image_url: row.image_url ? String(row.image_url).trim() : null,
        embedded_image: embeddedImage,
        original_price: row.original_price !== undefined && row.original_price !== '' ? Number(row.original_price) : null,
        sale_price: Number(row.sale_price),
        composition: String(row.composition).trim(),
        packaging: row.packaging ? String(row.packaging).trim() : null,
        origin: row.origin ? String(row.origin).trim() : null,
        tax_type: taxType || null,
        features: row.features ? String(row.features).trim() : null,
        description: row.description ? String(row.description).trim() : null,
        shipping_info: row.shipping_info ? String(row.shipping_info).trim() : null,
        promo_badge: promoBadge && promoBadge !== '미선택' ? promoBadge : null,
      });
    }
  });

  return { validRows, errors };
}

module.exports = { validateRows, isValidUrl, hasImageExtension, isValidPrice };
