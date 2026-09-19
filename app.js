const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const methodOverride = require('method-override');

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = require('./config/db');
connectDB();

const app = express();

// Trust reverse proxy (Required for secure HTTPS session cookies on Render/Heroku)
app.set('trust proxy', 1);

// Handle favicon.ico gracefully
app.get('/favicon.ico', (req, res) => res.status(204).end());

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Method override for PUT & DELETE from HTML forms
app.use(methodOverride('_method'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'smart_business_secret_key_change_in_prod',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_business_manager',
      collectionName: 'sessions',
      ttl: 24 * 60 * 60, // 1 day
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);

// Flash messages
app.use(flash());

// Global template variables middleware
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.currentUser = req.session?.user || null;
  res.locals.isDemoUser = req.session?.isDemo || false;
  res.locals.currentBusinessName = req.session?.user?.businessName || 'My Business';
  res.locals.currentPath = req.path;
  next();
});

// Routes
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const inventoryRoutes = require('./routes/inventory');
const supplierRoutes = require('./routes/suppliers');
const purchaseRoutes = require('./routes/purchases');
const customerRoutes = require('./routes/customers');
const salesRoutes = require('./routes/sales');
const staffRoutes = require('./routes/staff');
const expenseRoutes = require('./routes/expenses');
const electricityRoutes = require('./routes/electricity');
const paymentRoutes = require('./routes/payments');
const profitRoutes = require('./routes/profit');
const analyticsRoutes = require('./routes/analytics');
const reportRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');

app.use('/', indexRoutes);
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/suppliers', supplierRoutes);
app.use('/purchases', purchaseRoutes);
app.use('/customers', customerRoutes);
app.use('/sales', salesRoutes);
app.use('/staff', staffRoutes);
app.use('/expenses', expenseRoutes);
app.use('/electricity', electricityRoutes);
app.use('/payments', paymentRoutes);
app.use('/profit', profitRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/reports', reportRoutes);
app.use('/settings', settingsRoutes);

// Error handling middleware
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');
app.use(notFoundHandler);
app.use(globalErrorHandler);

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`[Server] Smart Business Manager running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`[Server] Access at http://localhost:${PORT}`);
});

module.exports = app;
