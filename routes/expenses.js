const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const expenseController = require('../controllers/expenseController');

// All expense routes require user authentication
router.use(isAuthenticated);

router.get('/', expenseController.getExpenses);
router.get('/new', expenseController.getNewExpense);
router.post('/', expenseController.postNewExpense);
router.get('/:id/edit', expenseController.getEditExpense);
router.put('/:id', expenseController.putExpense);
router.post('/:id/pay', expenseController.postMarkAsPaid);
router.delete('/:id', expenseController.deleteExpense);

module.exports = router;
