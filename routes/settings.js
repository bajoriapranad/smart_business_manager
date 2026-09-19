const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

// All settings routes require authentication
router.use(isAuthenticated);

router.get('/', settingsController.getSettings);
router.post('/profile', settingsController.updateStoreProfile);
router.post('/preferences', settingsController.updatePreferences);
router.post('/loyalty', settingsController.updateLoyaltySettings);
router.get('/backup', settingsController.exportDatabaseBackup);

module.exports = router;
