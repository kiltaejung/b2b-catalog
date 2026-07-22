const ExcelJS = require('exceljs');
const { imageSize } = require('image-size');
const { fetchImageBuffer } = require('./safeImageFetch');

const IMAGE_BOX_PX = 100;
const ROW_HEIGHT_POINTS = 80.1;
const IMAGE_COL_WIDTH_PX = 130; // approx rendered pixels for a width:18.5 column

// Fixed to match the company's standard product-list template exactly —
// these are pinned display values, not derived from per-product data.
const SUPPLIER_NAME = '(주)포스라';
const SUPPLIER_CONTACT_LINE = '길태정 부장 / 010-4499-5194';
const SUPPLIER_EMAIL = 'ktj@fosla.co.kr';
const VAT_NOTE = '(부가세 및 배송비 포함)';
const DEFAULT_TITLE = '상품목록';

// Column order/titles fixed to the template — do not add/remove/reorder.
const EXPORT_COLUMNS = [
  { key: 'image', header: '대표이미지', width: 18.5 },
  { key: 'category', header: '카테고리', width: 19.875 },
  { key: 'productCode', header: '상품코드', width: 16 },
  { key: 'name', header: '상품명', width: 31 },
  { key: 'composition', header: '상품구성', width: 20 },
  { key: 'packaging', header: '포장', width: 16 },
  { key: 'salePrice', header: '판매가', width: 12 },
];

const LAST_COL_LETTER = 'G';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };
const LABEL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
const THIN_BORDER = {
  left: { style: 'thin', color: { indexed: 64 } },
  right: { style: 'thin', color: { indexed: 64 } },
  top: { style: 'thin', color: { indexed: 64 } },
  bottom: { style: 'thin', color: { indexed: 64 } },
};

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

async function buildProductExportWorkbook(products, title) {
  const imageBuffers = await Promise.all(products.map((p) => fetchImageBuffer(p.image_url)));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'B2B Catalog System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('상품목록', {
    views: [{ state: 'frozen', ySplit: 4, topLeftCell: 'A5' }],
  });
  sheet.columns = EXPORT_COLUMNS.map(({ key, width }) => ({ key, width }));

  // Row 1: title, merged across the full width.
  sheet.mergeCells(`A1:${LAST_COL_LETTER}1`);
  const titleRow = sheet.getRow(1);
  titleRow.height = 29.25;
  titleRow.getCell(1).value = title || DEFAULT_TITLE;
  titleRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 14, name: '맑은 고딕' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Row 2: fixed supplier / contact / email block.
  sheet.mergeCells(`F2:${LAST_COL_LETTER}2`);
  const supplierRow = sheet.getRow(2);
  supplierRow.getCell(1).value = '상품공급사';
  supplierRow.getCell(2).value = SUPPLIER_NAME;
  supplierRow.getCell(3).value = '담당자';
  supplierRow.getCell(4).value = SUPPLIER_CONTACT_LINE;
  supplierRow.getCell(5).value = '이메일';
  supplierRow.getCell(6).value = { text: SUPPLIER_EMAIL, hyperlink: `mailto:${SUPPLIER_EMAIL}` };
  supplierRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = { bold: true, size: 11, name: '맑은 고딕' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = THIN_BORDER;
    if (colNumber === 1 || colNumber === 3 || colNumber === 5) cell.fill = LABEL_FILL;
    if (colNumber === 6) cell.font = { bold: true, underline: true, size: 11, name: '맑은 고딕', color: { argb: 'FF0563C1' } };
  });

  // Row 3: VAT/shipping note, right-aligned in the last column.
  const noteRow = sheet.getRow(3);
  noteRow.height = 28.5;
  noteRow.getCell(EXPORT_COLUMNS.length).value = VAT_NOTE;
  noteRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = { size: 11, name: '맑은 고딕' };
    cell.alignment = { horizontal: colNumber === EXPORT_COLUMNS.length ? 'right' : 'center' };
  });

  // Row 4: column headers (fixed titles/order — matches the company template).
  const headerRow = sheet.getRow(4);
  EXPORT_COLUMNS.forEach((col, i) => {
    headerRow.getCell(i + 1).value = col.header;
  });
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 11, name: '맑은 고딕' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  });
  sheet.autoFilter = { from: 'A4', to: `${LAST_COL_LETTER}4` };

  products.forEach((p, index) => {
    const row = sheet.addRow({
      image: '',
      category: p.category,
      productCode: p.product_code,
      name: p.name,
      composition: p.composition,
      packaging: p.packaging || '',
      salePrice: Number(p.sale_price),
    });
    const rowNumber = row.number;
    row.height = ROW_HEIGHT_POINTS;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 11, name: '맑은 고딕' };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = THIN_BORDER;
    });
    row.getCell('salePrice').numFmt = '#,##0';

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
