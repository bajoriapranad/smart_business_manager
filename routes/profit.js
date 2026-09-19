const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const profitController = require('../controllers/profitController');

// All profit analytics routes require authentication
router.use(isAuthenticated);

router.get('/', profitController.getProfitDashboard);

module.exports = router;
