const express = require('express');
const router = express.Router();
const controller = require('../controllers/catalogController');

router.get('/', controller.listCatalogs);
router.post('/', controller.createCatalog);
router.get('/:id', controller.getCatalog);
router.delete('/:id', controller.deleteCatalog);

module.exports = router;
