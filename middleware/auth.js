// Authentication Middleware
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  req.flash('error_msg', 'Please login to access this page.');
  return res.redirect('/auth/login');
};

const isGuest = (req, res, next) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  return next();
};

module.exports = {
  isAuthenticated,
  isGuest,
};
