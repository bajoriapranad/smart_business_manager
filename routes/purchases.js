const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const purchaseController = require('../controllers/purchaseController');

// All purchase routes require user authentication
router.use(isAuthenticated);

router.get('/', purchaseController.getPurchases);
router.get('/new', purchaseController.getNewPurchase);
router.post('/', purchaseController.postNewPurchase);
router.get('/:id', purchaseController.getPurchaseDetail);
router.post('/:id/payments', purchaseController.postRecordPayment);
router.delete('/:id', purchaseController.deletePurchase);

module.exports = router;
