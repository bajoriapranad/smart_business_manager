const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const staffController = require('../controllers/staffController');

// All staff routes require user authentication
router.use(isAuthenticated);

router.get('/', staffController.getStaffList);
router.get('/new', staffController.getNewStaff);
router.post('/', staffController.postNewStaff);
router.get('/:id', staffController.getStaffDetail);
router.get('/:id/edit', staffController.getEditStaff);
router.put('/:id', staffController.putStaff);
router.post('/:id/payments', staffController.postDisburseSalary);
router.delete('/payments/:paymentId', staffController.deletePaymentVoucher);
router.delete('/:id', staffController.deleteStaff);

module.exports = router;
