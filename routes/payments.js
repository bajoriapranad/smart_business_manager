const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const paymentController = require('../controllers/paymentController');

// All payment routes require user authentication
router.use(isAuthenticated);

router.get('/', paymentController.getPaymentsHub);
router.post('/customer/:id/pay', paymentController.postCustomerPay);
router.post('/supplier/:id/pay', paymentController.postSupplierPay);
router.post('/expense/:id/pay', paymentController.postExpensePay);
router.post('/electricity/:id/pay', paymentController.postElectricityPay);

module.exports = router;
