const express = require('express');
const router = express.Router();
const controller = require('../controllers/quoteController');

router.post('/', controller.createQuote);
router.get('/', controller.listQuotes);
router.get('/:id', controller.getQuote);

module.exports = router;
