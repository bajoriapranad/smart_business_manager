const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const saleController = require('../controllers/saleController');

// All sales routes require authentication
router.use(isAuthenticated);

router.get('/', saleController.getSales);
router.get('/pos', saleController.getPOS);
router.get('/new', saleController.getPOS); // Convenient alias to POS
router.post('/', saleController.postCheckout);
router.get('/:id', saleController.getSaleReceipt);
router.delete('/:id', saleController.deleteSale);

module.exports = router;
