const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const analyticsController = require('../controllers/analyticsController');

// All analytics routes require user authentication
router.use(isAuthenticated);

router.get('/', analyticsController.getAnalyticsDashboard);

module.exports = router;
