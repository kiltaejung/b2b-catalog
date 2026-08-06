const multer = require('multer');

const storage = multer.memoryStorage();

// Excel files can now carry embedded product photos (pasted directly into
// cells) instead of just image URLs, so a bulk upload with many rows of
// real photos is easily well past what a text-only spreadsheet ever was -
// 10MB was sized for the old URL-only case and rejected real catalogs.
const excelUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('엑셀(.xlsx, .xls) 파일만 업로드할 수 있습니다.'));
    }
  },
});

const imageUpload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('JPG, PNG, WEBP 이미지 파일만 업로드할 수 있습니다.'));
    }
  },
});

module.exports = { excelUpload, imageUpload };
