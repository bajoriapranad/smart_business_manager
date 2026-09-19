const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const inventoryController = require('../controllers/inventoryController');

// All inventory routes require authentication
router.use(isAuthenticated);

// Category Management Routes
router.get('/categories', inventoryController.getCategories);
router.post('/categories', inventoryController.postCategory);
router.post('/categories/:id/edit', inventoryController.putCategory);
router.put('/categories/:id', inventoryController.putCategory);
router.post('/categories/:id/delete', inventoryController.deleteCategory);
router.delete('/categories/:id', inventoryController.deleteCategory);

// Product CRUD Routes
router.get('/', inventoryController.getProducts);
router.get('/new', inventoryController.getNewProduct);
router.post('/', inventoryController.postNewProduct);
router.get('/:id', inventoryController.getProductDetail);
router.get('/:id/edit', inventoryController.getEditProduct);
router.put('/:id', inventoryController.putProduct);
router.delete('/:id', inventoryController.deleteProduct);

module.exports = router;
