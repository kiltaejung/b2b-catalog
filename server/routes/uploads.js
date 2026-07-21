const express = require('express');
const router = express.Router();
const controller = require('../controllers/uploadController');
const { imageUpload } = require('../middleware/upload');

router.post('/', imageUpload.single('file'), controller.createUpload);
router.get('/:id', controller.getUpload);

module.exports = router;
