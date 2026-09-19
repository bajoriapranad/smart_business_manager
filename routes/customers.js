const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const customerController = require('../controllers/customerController');

// All customer routes require authentication
router.use(isAuthenticated);

router.get('/', customerController.getCustomers);
router.get('/new', customerController.getNewCustomer);
router.post('/', customerController.postNewCustomer);
router.get('/:id', customerController.getCustomerDetail);
router.get('/:id/edit', customerController.getEditCustomer);
router.put('/:id', customerController.putCustomer);
router.post('/:id/payments', customerController.postRecordCustomerPayment);
router.delete('/:id', customerController.deleteCustomer);

module.exports = router;
