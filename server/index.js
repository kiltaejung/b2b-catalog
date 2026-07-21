require('dotenv').config();
require('express-async-errors');
const path = require('path');
const express = require('express');
const cors = require('cors');

const productRoutes = require('./routes/products');
const catalogRoutes = require('./routes/catalogs');
const quoteRoutes = require('./routes/quotes');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.KAKAO_JS_KEY = ${JSON.stringify(process.env.KAKAO_JS_KEY || '')};`);
});

app.use('/api/products', productRoutes);
app.use('/api/catalogs', catalogRoutes);
app.use('/api/quotes', quoteRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`B2B catalog server listening on port ${PORT}`);
});
