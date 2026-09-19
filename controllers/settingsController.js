const mongoose = require('mongoose');
const BusinessSettings = require('../models/BusinessSettings');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Sale = require('../models/Sale');
const Purchase = require('../models/Purchase');
const Staff = require('../models/Staff');
const StaffPayment = require('../models/StaffPayment');
const Expense = require('../models/Expense');
const ElectricityBill = require('../models/ElectricityBill');

// 1. Get Settings Dashboard
const getSettings = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);

    let settings = await BusinessSettings.findOne({ userId });
    if (!settings) {
      settings = await BusinessSettings.create({
        userId,
        businessName: req.session.user?.businessName || 'My Retail Store',
        businessPhone: '',
        email: req.session.user?.email || '',
        address: '',
        gstin: '',
        currency: '₹',
        defaultTax: 0,
        lowStockThreshold: 10,
        invoiceFooterNotes: 'Thank you for shopping with us! Please visit again.',
        enableLoyalty: true,
        defaultCustomerDiscount: 0,
        loyaltyTiers: [
          { name: 'Bronze', minSpend: 0, discountPercent: 0 },
          { name: 'Silver', minSpend: 5000, discountPercent: 5 },
          { name: 'Gold', minSpend: 15000, discountPercent: 10 },
        ],
      });
    }

    // Ensure default loyalty tiers if array is empty
    if (!settings.loyaltyTiers || settings.loyaltyTiers.length === 0) {
      settings.loyaltyTiers = [
        { name: 'Bronze', minSpend: 0, discountPercent: 0 },
        { name: 'Silver', minSpend: 5000, discountPercent: 5 },
        { name: 'Gold', minSpend: 15000, discountPercent: 10 },
      ];
      await settings.save();
    }

    // Count database records for the backup card summary
    const [
      productsCount,
      categoriesCount,
      customersCount,
      suppliersCount,
      salesCount,
      purchasesCount,
      staffCount,
      expensesCount,
      electricityCount,
    ] = await Promise.all([
      Product.countDocuments({ userId }),
      Category.countDocuments({ userId }),
      Customer.countDocuments({ userId }),
      Supplier.countDocuments({ userId }),
      Sale.countDocuments({ userId }),
      Purchase.countDocuments({ userId }),
      Staff.countDocuments({ userId }),
      Expense.countDocuments({ userId }),
      ElectricityBill.countDocuments({ userId }),
    ]);

    res.render('settings/index', {
      title: 'Settings & Business Preferences',
      settings,
      counts: {
        products: productsCount,
        categories: categoriesCount,
        customers: customersCount,
        suppliers: suppliersCount,
        sales: salesCount,
        purchases: purchasesCount,
        staff: staffCount,
        expenses: expensesCount,
        electricity: electricityCount,
        totalRecords:
          productsCount +
          categoriesCount +
          customersCount +
          suppliersCount +
          salesCount +
          purchasesCount +
          staffCount +
          expensesCount +
          electricityCount,
      },
      activeMenu: 'settings',
    });
  } catch (error) {
    console.error('[Settings Controller] getSettings error:', error);
    req.flash('error_msg', 'Failed to load settings.');
    res.redirect('/dashboard');
  }
};

// 2. Update Store Profile
const updateStoreProfile = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { businessName, businessPhone, email, address, gstin } = req.body;

    if (!businessName || !businessName.trim()) {
      req.flash('error_msg', 'Business name is required.');
      return res.redirect('/settings');
    }

    const trimmedName = businessName.trim();

    await BusinessSettings.findOneAndUpdate(
      { userId },
      {
        businessName: trimmedName,
        businessPhone: businessPhone ? businessPhone.trim() : '',
        email: email ? email.trim() : '',
        address: address ? address.trim() : '',
        gstin: gstin ? gstin.trim().toUpperCase() : '',
      },
      { upsert: true, new: true }
    );

    // Update User model and active session
    await User.findByIdAndUpdate(userId, { businessName: trimmedName });
    if (req.session.user) {
      req.session.user.businessName = trimmedName;
    }

    req.flash('success_msg', 'Store profile updated successfully.');
    res.redirect('/settings');
  } catch (error) {
    console.error('[Settings Controller] updateStoreProfile error:', error);
    req.flash('error_msg', 'Failed to update store profile.');
    res.redirect('/settings');
  }
};

// 3. Update Commercial & Financial Preferences
const updatePreferences = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { currency, defaultTax, lowStockThreshold, invoiceFooterNotes } = req.body;

    const parsedTax = parseFloat(defaultTax);
    const parsedStock = parseInt(lowStockThreshold, 10);

    await BusinessSettings.findOneAndUpdate(
      { userId },
      {
        currency: currency ? currency.trim() : '₹',
        defaultTax: isNaN(parsedTax) ? 0 : Math.max(0, Math.min(100, parsedTax)),
        lowStockThreshold: isNaN(parsedStock) ? 10 : Math.max(1, parsedStock),
        invoiceFooterNotes: invoiceFooterNotes ? invoiceFooterNotes.trim() : '',
      },
      { upsert: true, new: true }
    );

    req.flash('success_msg', 'Operating preferences updated successfully.');
    res.redirect('/settings');
  } catch (error) {
    console.error('[Settings Controller] updatePreferences error:', error);
    req.flash('error_msg', 'Failed to update preferences.');
    res.redirect('/settings');
  }
};

// 4. Update Loyalty Program Settings
const updateLoyaltySettings = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const {
      enableLoyalty,
      defaultCustomerDiscount,
      bronzeSpend,
      bronzeDiscount,
      silverSpend,
      silverDiscount,
      goldSpend,
      goldDiscount,
    } = req.body;

    const isEnabled = enableLoyalty === 'on' || enableLoyalty === true || enableLoyalty === 'true';
    const parsedDiscount = parseFloat(defaultCustomerDiscount) || 0;

    const tiers = [
      {
        name: 'Bronze',
        minSpend: parseFloat(bronzeSpend) || 0,
        discountPercent: parseFloat(bronzeDiscount) || 0,
      },
      {
        name: 'Silver',
        minSpend: parseFloat(silverSpend) || 5000,
        discountPercent: parseFloat(silverDiscount) || 5,
      },
      {
        name: 'Gold',
        minSpend: parseFloat(goldSpend) || 15000,
        discountPercent: parseFloat(goldDiscount) || 10,
      },
    ];

    await BusinessSettings.findOneAndUpdate(
      { userId },
      {
        enableLoyalty: isEnabled,
        defaultCustomerDiscount: Math.max(0, Math.min(100, parsedDiscount)),
        loyaltyTiers: tiers,
      },
      { upsert: true, new: true }
    );

    req.flash('success_msg', 'Customer loyalty program settings updated successfully.');
    res.redirect('/settings');
  } catch (error) {
    console.error('[Settings Controller] updateLoyaltySettings error:', error);
    req.flash('error_msg', 'Failed to update loyalty settings.');
    res.redirect('/settings');
  }
};

// 5. Full JSON Database Backup Export
const exportDatabaseBackup = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);

    const [
      settings,
      categories,
      products,
      customers,
      suppliers,
      sales,
      purchases,
      staff,
      staffPayments,
      expenses,
      electricityBills,
    ] = await Promise.all([
      BusinessSettings.findOne({ userId }),
      Category.find({ userId }),
      Product.find({ userId }),
      Customer.find({ userId }),
      Supplier.find({ userId }),
      Sale.find({ userId }),
      Purchase.find({ userId }),
      Staff.find({ userId }),
      StaffPayment.find({ userId }),
      Expense.find({ userId }),
      ElectricityBill.find({ userId }),
    ]);

    const backupPayload = {
      system: 'Smart Business Manager',
      backupVersion: '1.0',
      exportedAt: new Date().toISOString(),
      businessName: settings?.businessName || req.session.user?.businessName || 'Store',
      manifest: {
        categories: categories.length,
        products: products.length,
        customers: customers.length,
        suppliers: suppliers.length,
        sales: sales.length,
        purchases: purchases.length,
        staff: staff.length,
        staffPayments: staffPayments.length,
        expenses: expenses.length,
        electricityBills: electricityBills.length,
      },
      data: {
        settings,
        categories,
        products,
        customers,
        suppliers,
        sales,
        purchases,
        staff,
        staffPayments,
        expenses,
        electricityBills,
      },
    };

    const fileName = `smart_business_backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(JSON.stringify(backupPayload, null, 2));
  } catch (error) {
    console.error('[Settings Controller] exportDatabaseBackup error:', error);
    req.flash('error_msg', 'Failed to generate database backup.');
    res.redirect('/settings');
  }
};

module.exports = {
  getSettings,
  updateStoreProfile,
  updatePreferences,
  updateLoyaltySettings,
  exportDatabaseBackup,
};
