const multer = require('multer');

const storage = multer.memoryStorage();

const excelUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
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

module.exports = { excelUpload };
