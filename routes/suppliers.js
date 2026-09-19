const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const supplierController = require('../controllers/supplierController');

// All supplier routes require authentication
router.use(isAuthenticated);

router.get('/', supplierController.getSuppliers);
router.get('/new', supplierController.getNewSupplier);
router.post('/', supplierController.postNewSupplier);
router.get('/:id', supplierController.getSupplierDetail);
router.get('/:id/edit', supplierController.getEditSupplier);
router.put('/:id', supplierController.putSupplier);
router.delete('/:id', supplierController.deleteSupplier);

module.exports = router;
