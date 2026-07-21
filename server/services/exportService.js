const dns = require('dns').promises;
const net = require('net');
const ExcelJS = require('exceljs');
const { imageSize } = require('image-size');

const IMAGE_FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_BOX_PX = 100;
const ROW_HEIGHT_POINTS = 80;
const IMAGE_COL_WIDTH_PX = 112; // approx rendered pixels for a width:16 column

const EXPORT_COLUMNS = [
  { header: '대표이미지', key: 'image', width: 16 },
  { header: '카테고리', key: 'category', width: 12 },
  { header: '상품코드', key: 'productCode', width: 16 },
  { header: '상품명', key: 'name', width: 26 },
  { header: '판매가', key: 'salePrice', width: 12 },
  { header: '상품구성', key: 'composition', width: 20 },
  { header: '포장', key: 'packaging', width: 16 },
  { header: '원산지', key: 'origin', width: 10 },
  { header: '규격', key: 'features', width: 16 },
  { header: '상품설명', key: 'description', width: 32 },
  { header: '배송안내', key: 'shippingInfo', width: 20 },
];

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    if (normalized.startsWith('::ffff:')) {
      const v4 = normalized.split(':').pop();
      return net.isIPv4(v4) ? isPrivateIp(v4) : false;
    }
    return false;
  }
  return true;
}

async function isSafeImageUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.hostname === 'localhost') return false;

  try {
    const results = await dns.lookup(parsed.hostname, { all: true });
    return results.length > 0 && results.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}

async function fetchImageBuffer(imageUrl) {
  if (!imageUrl) return null;
  if (!(await isSafeImageUrl(imageUrl))) return null;

  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength && contentLength > MAX_IMAGE_BYTES) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    return buffer;
  } catch {
    return null;
  }
}

function excelImageExtension(dimensions) {
  if (dimensions.type === 'jpg' || dimensions.type === 'jpeg') return 'jpeg';
  if (dimensions.type === 'png') return 'png';
  return null; // exceljs cannot embed webp/other formats directly
}

function todayStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function buildExportFilename(isFiltered) {
  const label = isFiltered ? '조회상품' : '전체상품';
  return `포스라_명절선물_${label}_${todayStamp()}.xlsx`;
}

// ASCII fallback for the plain Content-Disposition filename= parameter
// (HTTP headers are historically ISO-8859-1; not every client honors the
// RFC 6266 filename* extension used for the real Korean name).
function buildExportFilenameAscii(isFiltered) {
  const label = isFiltered ? 'filtered_products' : 'all_products';
  return `fosla_gift_${label}_${todayStamp()}.xlsx`;
}

async function buildProductExportWorkbook(products) {
  const imageBuffers = await Promise.all(products.map((p) => fetchImageBuffer(p.image_url)));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'B2B Catalog System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('상품목록', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = EXPORT_COLUMNS;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  sheet.autoFilter = { from: 'A1', to: `K1` };

  products.forEach((p, index) => {
    const row = sheet.addRow({
      image: '',
      category: p.category,
      productCode: p.product_code,
      name: p.name,
      salePrice: Number(p.sale_price),
      composition: p.composition,
      packaging: p.packaging || '',
      origin: p.origin || '',
      features: p.features || '',
      description: p.description || '',
      shippingInfo: p.shipping_info || '',
    });
    const rowNumber = row.number;
    row.height = ROW_HEIGHT_POINTS;
    row.alignment = { vertical: 'middle', wrapText: true };
    row.getCell('salePrice').numFmt = '#,##0';
    row.getCell('salePrice').alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell('image').alignment = { vertical: 'middle', horizontal: 'center' };

    const buffer = imageBuffers[index];
    let embedded = false;
    if (buffer) {
      try {
        const dimensions = imageSize(buffer);
        const extension = excelImageExtension(dimensions);
        if (extension && dimensions.width && dimensions.height) {
          const scale = Math.min(IMAGE_BOX_PX / dimensions.width, IMAGE_BOX_PX / dimensions.height, 1);
          const drawWidth = dimensions.width * scale;
          const drawHeight = dimensions.height * scale;
          const cellHeightPx = ROW_HEIGHT_POINTS * 1.333;
          const offsetXFraction = Math.max(0, (IMAGE_COL_WIDTH_PX - drawWidth) / 2 / IMAGE_COL_WIDTH_PX);
          const offsetYFraction = Math.max(0, (cellHeightPx - drawHeight) / 2 / cellHeightPx);

          const imageId = workbook.addImage({ buffer, extension });
          sheet.addImage(imageId, {
            tl: { col: 0 + offsetXFraction, row: (rowNumber - 1) + offsetYFraction },
            ext: { width: drawWidth, height: drawHeight },
            editAs: 'oneCell',
          });
          embedded = true;
        }
      } catch {
        embedded = false;
      }
    }
    if (!embedded) {
      row.getCell('image').value = '이미지 없음';
    }
  });

  const buf = await workbook.xlsx.writeBuffer();
  return buf;
}

module.exports = { buildProductExportWorkbook, buildExportFilename, buildExportFilenameAscii };
