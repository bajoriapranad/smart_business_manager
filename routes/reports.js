const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const reportController = require('../controllers/reportController');

// All reports routes require user authentication
router.use(isAuthenticated);

router.get('/', reportController.getReportsHub);
router.get('/sales', reportController.getSalesReport);
router.get('/inventory', reportController.getInventoryReport);
router.get('/customers', reportController.getCustomerReport);
router.get('/purchases', reportController.getPurchaseReport);
router.get('/expenses', reportController.getExpenseReport);
router.get('/print', reportController.printStatement);

module.exports = router;
