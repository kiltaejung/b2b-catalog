const XLSX = require('xlsx');

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
  '원산지',
  '상품특징',
  '상품설명',
  '배송안내',
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
  '원산지': 'origin',
  '상품특징': 'features',
  '상품설명': 'description',
  '배송안내': 'shipping_info',
};

function buildTemplateBuffer() {
  const worksheet = XLSX.utils.aoa_to_sheet([
    HEADERS,
    [1, '과일', 'FRUIT-001', '예시 상품명', '예시 브랜드', 'https://example.com/image.jpg', 20000, 15000, '1box (10입)', '국산', '당도 선별', '상품 설명 예시', '택배 배송 (2~3일 소요)'],
  ]);
  worksheet['!cols'] = HEADERS.map(() => ({ wch: 20 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '상품등록양식');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function parseWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });

  return raw.map((row) => {
    const mapped = {};
    Object.entries(row).forEach(([header, value]) => {
      const field = HEADER_TO_FIELD[header.trim()];
      if (field) {
        mapped[field] = typeof value === 'string' ? value.trim() : value;
      }
    });
    return mapped;
  });
}

module.exports = { buildTemplateBuffer, parseWorkbookBuffer, HEADERS, HEADER_TO_FIELD };
