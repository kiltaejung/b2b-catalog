const ExcelJS = require('exceljs');
const { Jimp } = require('jimp');

const IMAGE_HEADER = '대표이미지 (URL 또는 이미지 삽입)';
// The exact header text used before this column was renamed - kept as a
// parsing alias so excel files built from an already-downloaded copy of the
// old template still upload correctly.
const IMAGE_HEADER_LEGACY = '대표이미지 URL';

const HEADERS = [
  '노출순서',
  '카테고리',
  '상품코드',
  '상품명',
  '브랜드',
  IMAGE_HEADER,
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
  [IMAGE_HEADER]: 'image_url',
  [IMAGE_HEADER_LEGACY]: 'image_url',
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

// Image column left blank - the template embeds an actual picture there
// instead (see buildTemplateBuffer), to show the new method rather than
// just describe it.
const EXAMPLE_ROW = [1, '과일', 'FRUIT-001', '예시 상품명', '예시 브랜드', '', 20000, 15000, '1box (10입)', '골판지 박스', '국산', '과세', '10kg', '상품 설명 예시', '택배 배송 (2~3일 소요)', '강력추천'];

// A small placeholder square embedded directly into the example row's image
// cell, so opening the template shows a real picture sitting in that column
// instead of just a written instruction that's easy to skim past.
async function buildExamplePictureBuffer() {
  const size = 120;
  const inset = 16;
  const img = new Jimp({ width: size, height: size, color: 0xffffffff });
  for (let y = inset; y < size - inset; y++) {
    for (let x = inset; x < size - inset; x++) {
      img.setPixelColor(0x2563ebff, x, y);
    }
  }
  return img.getBuffer('image/png');
}

async function buildTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('상품등록양식');
  sheet.columns = HEADERS.map(() => ({ width: 20 }));

  const imageColIndex = HEADERS.indexOf(IMAGE_HEADER) + 1;

  // A banner row above the headers, since a small hover-comment on the
  // header cell alone is easy to miss entirely.
  const bannerRow = sheet.addRow([`※ "${IMAGE_HEADER}" 열에는 이미지 URL을 입력하거나, 아래 예시 행처럼 이미지 파일(JPG/PNG)을 셀에 직접 붙여넣기(Ctrl+V)나 삽입해도 됩니다.`]);
  sheet.mergeCells(bannerRow.number, 1, bannerRow.number, HEADERS.length);
  bannerRow.height = 34;
  bannerRow.font = { bold: true, color: { argb: 'FFB91C1C' } };
  bannerRow.alignment = { vertical: 'middle', wrapText: true };

  const headerRow = sheet.addRow(HEADERS);
  headerRow.font = { bold: true };
  headerRow.getCell(imageColIndex).note = '이미지 URL을 입력하거나, 이 열의 해당 행 셀에 이미지 파일(JPG/PNG)을 직접 붙여넣기/삽입해도 됩니다.';

  const exampleRow = sheet.addRow(EXAMPLE_ROW);
  exampleRow.height = 90;

  const pictureBuffer = await buildExamplePictureBuffer();
  const imageId = workbook.addImage({ buffer: pictureBuffer, extension: 'png' });
  sheet.addImage(imageId, {
    tl: { col: imageColIndex - 1, row: exampleRow.number - 1 },
    ext: { width: 80, height: 80 },
  });

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

// The current template has an instruction banner above the real header row
// (see buildTemplateBuffer), and older downloaded copies have the header at
// row 1 with no banner at all - rather than hardcode a row number, pick
// whichever of the first few rows matches the most known header names.
function findHeaderRowNumber(sheet) {
  let headerRowNumber = 1;
  let bestMatches = 0;
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > 5) return;
    let matches = 0;
    row.eachCell({ includeEmpty: true }, (cell) => {
      const header = String(cellText(cell) || '').trim();
      if (HEADER_TO_FIELD[header]) matches += 1;
    });
    if (matches > bestMatches) {
      bestMatches = matches;
      headerRowNumber = rowNumber;
    }
  });
  return headerRowNumber;
}

async function parseWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRowNumber = findHeaderRowNumber(sheet);
  const headerRow = sheet.getRow(headerRowNumber);
  const columnFields = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = String(cellText(cell) || '').trim();
    columnFields[colNumber] = HEADER_TO_FIELD[header];
  });

  const rowImages = extractRowImages(workbook, sheet);

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const mapped = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const field = columnFields[colNumber];
      if (!field) return;
      const value = cellText(cell);
      mapped[field] = typeof value === 'string' ? value.trim() : value;
    });
    if (rowImages.has(rowNumber)) mapped._embeddedImage = rowImages.get(rowNumber);
    if (mapped._embeddedImage || Object.values(mapped).some((v) => v !== '' && v !== undefined && v !== null)) {
      mapped._rowNumber = rowNumber;
      rows.push(mapped);
    }
  });

  return rows;
}

module.exports = { buildTemplateBuffer, parseWorkbookBuffer, HEADERS, HEADER_TO_FIELD };
