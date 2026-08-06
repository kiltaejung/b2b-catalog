require('dotenv').config();
require('express-async-errors');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const productRoutes = require('./routes/products');
const catalogRoutes = require('./routes/catalogs');
const quoteRoutes = require('./routes/quotes');
const uploadRoutes = require('./routes/uploads');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/config.js', (req, res) => {
  const config = {
    KAKAO_JS_KEY: process.env.KAKAO_JS_KEY || '',
    COMPANY_NAME: process.env.COMPANY_NAME || '(주)포스라',
    COMPANY_BIZ_NO: process.env.COMPANY_BIZ_NO || '278-86-03088',
    COMPANY_CEO: process.env.COMPANY_CEO || '길태정',
    COMPANY_PHONE: process.env.COMPANY_PHONE || '1661-9978 / 010-4499-5194',
    COMPANY_EMAIL: process.env.COMPANY_EMAIL || 'ktj@fosla.co.kr',
    COMPANY_LOGO_URL: process.env.COMPANY_LOGO_URL || '/assets/fosla-logo.png',
    COMPANY_STAMP_URL: process.env.COMPANY_STAMP_URL || 'https://img.welfareplus.com/img/gds/00477/w/4773850_2.png?t=20260721174905',
    BANK_NAME: process.env.BANK_NAME || '국민은행',
    BANK_ACCOUNT_HOLDER: process.env.BANK_ACCOUNT_HOLDER || '(주)포스라',
    BANK_ACCOUNT_NUMBER: process.env.BANK_ACCOUNT_NUMBER || '421701-04-307633',
  };
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = ${JSON.stringify(config)};`);
});

app.use('/api/products', productRoutes);
app.use('/api/catalogs', catalogRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/uploads', uploadRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      // Both upload routes register their file under the same field name
      // ('file'), so the request path - not err.field - is what tells the
      // two limits (excel vs. logo/product image) apart here.
      const limitMb = req.path.startsWith('/api/products/upload') ? 50 : 3;
      return res.status(400).json({ error: `파일 용량이 너무 큽니다. (최대 ${limitMb}MB까지 업로드할 수 있습니다.)` });
    }
    return res.status(400).json({ error: '파일 업로드에 실패했습니다. 파일을 확인해주세요.' });
  }
  console.error(err);
  res.status(500).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`B2B catalog server listening on port ${PORT}`);
});
