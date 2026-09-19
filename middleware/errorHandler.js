// Centralized Error Handling Middleware
const notFoundHandler = (req, res, next) => {
  const error = new Error(`Resource Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const globalErrorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);

  console.error(`[Error] ${err.message}`, err.stack);

  // If request expects JSON (e.g. API lookup)
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.json({
      success: false,
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
  }

  // Render error page
  res.render('error', {
    title: `Error ${statusCode}`,
    statusCode,
    message: err.message || 'An unexpected server error occurred.',
    activeMenu: '',
    currentUser: req.session?.user || null,
    isDemoUser: req.session?.isDemo || false,
    currentBusinessName: req.session?.businessName || 'Smart Business Manager',
  });
};

module.exports = {
  notFoundHandler,
  globalErrorHandler,
};
