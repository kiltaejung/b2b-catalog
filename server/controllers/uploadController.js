const pool = require('../config/db');

async function createUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: '업로드할 이미지 파일이 없습니다.' });

  const { rows } = await pool.query(
    'INSERT INTO uploads (mime_type, data) VALUES ($1, $2) RETURNING id',
    [req.file.mimetype, req.file.buffer]
  );
  res.status(201).json({ url: `/api/uploads/${rows[0].id}` });
}

async function getUpload(req, res) {
  const { rows } = await pool.query('SELECT mime_type, data FROM uploads WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).end();
  res.setHeader('Content-Type', rows[0].mime_type);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(rows[0].data);
}

module.exports = { createUpload, getUpload };
