const express = require('express');
const router = express.Router();
const controller = require('../controllers/productController');
const { excelUpload } = require('../middleware/upload');

router.get('/template', controller.downloadTemplate);
router.post('/upload', excelUpload.single('file'), controller.uploadProducts);
router.get('/', controller.listProducts);
router.get('/:id', controller.getProduct);
router.post('/', controller.createProduct);
router.put('/:id', controller.updateProduct);
router.delete('/:id', controller.deleteProduct);

module.exports = router;
