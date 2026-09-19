const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const electricityController = require('../controllers/electricityController');

// All electricity routes require user authentication
router.use(isAuthenticated);

router.get('/', electricityController.getElectricityBills);
router.get('/new', electricityController.getNewBill);
router.post('/', electricityController.postNewBill);
router.get('/:id/edit', electricityController.getEditBill);
router.put('/:id', electricityController.putBill);
router.post('/:id/pay', electricityController.postPayBill);
router.delete('/:id', electricityController.deleteBill);

module.exports = router;
