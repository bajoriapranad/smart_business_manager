const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isGuest, isAuthenticated } = require('../middleware/auth');

// Public Guest Routes
router.get('/register', isGuest, authController.getRegister);
router.post('/register', isGuest, authController.postRegister);

router.get('/login', isGuest, authController.getLogin);
router.post('/login', isGuest, authController.postLogin);

// Enter Demo Mode Route
router.get('/demo', authController.enterDemoMode);

// Protected/Session Routes
router.post('/logout', isAuthenticated, authController.logout);
router.get('/logout', authController.logout); // Fallback GET for user convenience

module.exports = router;
