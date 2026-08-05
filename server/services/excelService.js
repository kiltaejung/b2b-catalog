const ExcelJS = require('exceljs');

const HEADERS = [
  '노출순서',
  '카테고리',
  '상품코드',
  '상품명',
  '브랜드',
  '대표이미지 URL',
  '정상가',
  '판매가',
  '상품구성',
  '포장',
  '원산지',
  '면세/과세',
  '규격',
  '상품설명',
  '배송안내',
  '홍보특징',
];

const HEADER_TO_FIELD = {
  '노출순서': 'display_order',
  '카테고리': 'category',
  '상품코드': 'product_code',
  '상품명': 'name',
  '브랜드': 'brand',
  '대표이미지 URL': 'image_url',
  '정상가': 'original_price',
  '판매가': 'sale_price',
  '상품구성': 'composition',
  '포장': 'packaging',
  '원산지': 'origin',
  '면세/과세': 'tax_type',
  '규격': 'features',
  '상품설명': 'description',
  '배송안내': 'shipping_info',
  '홍보특징': 'promo_badge',
};

const EXAMPLE_ROW = [1, '과일', 'FRUIT-001', '예시 상품명', '예시 브랜드', 'https://example.com/image.jpg', 20000, 15000, '1box (10입)', '골판지 박스', '국산', '과세', '10kg', '상품 설명 예시', '택배 배송 (2~3일 소요)', '강력추천'];

async function buildTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('상품등록양식');
  sheet.columns = HEADERS.map((header) => ({ header, width: 20 }));
  sheet.addRow(EXAMPLE_ROW);
  sheet.getRow(1).font = { bold: true };

  const imageColIndex = HEADERS.indexOf('대표이미지 URL') + 1;
  sheet.getRow(1).getCell(imageColIndex).note = 'URL을 입력하는 대신, 이 열의 해당 행 셀에 이미지 파일(JPG/PNG)을 직접 붙여넣거나 삽입해도 됩니다.';

  return workbook.xlsx.writeBuffer();
}

function cellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('result' in value) return value.result ?? '';
    if ('text' in value) return value.text ?? '';
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
  }
  return value;
}

const IMAGE_EXT_TO_MIME = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png' };

// Excel lets a picture be pasted/dropped directly into a cell instead of
// typing a URL - it's stored as a separate "floating" drawing anchored to a
// row/col position, not as cell content, so it has to be read via the
// worksheet's own image list and matched back to a row by that anchor,
// rather than through row.eachCell() like every other column.
function extractRowImages(workbook, sheet) {
  const map = new Map();
  const media = (workbook.model && workbook.model.media) || [];
  sheet.getImages().forEach((img) => {
    const item = media.find((m) => String(m.index) === String(img.imageId));
    if (!item || !item.buffer) return;
    const mimeType = IMAGE_EXT_TO_MIME[String(item.extension || '').toLowerCase()];
    if (!mimeType) return; // unsupported embedded format (e.g. gif/bmp) - falls back to the URL column
    const rowNumber = Math.round(img.range.tl.nativeRow) + 1;
    if (!map.has(rowNumber)) map.set(rowNumber, { buffer: item.buffer, mimeType });
  });
  return map;
}

async function parseWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const columnFields = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = String(cellText(cell) || '').trim();
    columnFields[colNumber] = HEADER_TO_FIELD[header];
  });

  const rowImages = extractRowImages(workbook, sheet);

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const mapped = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const field = columnFields[colNumber];
      if (!field) return;
      const value = cellText(cell);
      mapped[field] = typeof value === 'string' ? value.trim() : value;
    });
    if (rowImages.has(rowNumber)) mapped._embeddedImage = rowImages.get(rowNumber);
    if (mapped._embeddedImage || Object.values(mapped).some((v) => v !== '' && v !== undefined && v !== null)) {
      rows.push(mapped);
    }
  });

  return rows;
}

module.exports = { buildTemplateBuffer, parseWorkbookBuffer, HEADERS, HEADER_TO_FIELD };
