const express = require('express');
const router = express.Router();

// Root route - Landing page if guest, or redirect to dashboard if already logged in
router.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  res.render('landing', {
    title: 'Smart Business Manager & Profit Analyser',
  });
});

module.exports = router;
