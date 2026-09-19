const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const BusinessSettings = require('../models/BusinessSettings');

const getDashboard = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);

    // Business Settings & Currency
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    // Date range for "Today"
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // 1. Today's Sales Aggregation
    const salesToday = await Sale.aggregate([
      {
        $match: {
          userId,
          saleDate: { $gte: startOfToday, $lte: endOfToday },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$finalAmount' },
          totalCOGS: { $sum: '$costOfGoodsSold' },
          totalGrossProfit: { $sum: '$grossProfit' },
          count: { $sum: 1 },
        },
      },
    ]);

    const todaySalesAmount = salesToday[0]?.totalRevenue || 0;
    const todayGrossProfit = salesToday[0]?.totalGrossProfit || 0;
    const todaySalesCount = salesToday[0]?.count || 0;

    // 2. Today's Expenses Aggregation
    const expensesToday = await Expense.aggregate([
      {
        $match: {
          userId,
          date: { $gte: startOfToday, $lte: endOfToday },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const todayExpenseAmount = expensesToday[0]?.totalAmount || 0;
    const todayExpenseCount = expensesToday[0]?.count || 0;

    // 3. Today's Net Profit = Today's Gross Profit - Today's Expenses
    const todayNetProfit = todayGrossProfit - todayExpenseAmount;

    // 4. Inventory Valuation
    const stockStats = await Product.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalStockValue: { $sum: { $multiply: ['$currentStock', '$purchasePrice'] } },
          totalPotentialRevenue: { $sum: { $multiply: ['$currentStock', '$sellingPrice'] } },
          totalItemsInStock: { $sum: '$currentStock' },
          totalProductTypes: { $sum: 1 },
        },
      },
    ]);

    const totalStockValue = stockStats[0]?.totalStockValue || 0;
    const totalPotentialRevenue = stockStats[0]?.totalPotentialRevenue || 0;
    const totalProductTypes = stockStats[0]?.totalProductTypes || 0;

    // 5. Low Stock Items (currentStock <= minimumStock)
    const lowStockItems = await Product.find({
      userId,
      $expr: { $lte: ['$currentStock', '$minimumStock'] },
    })
      .populate('category', 'name')
      .sort({ currentStock: 1 })
      .limit(6);

    const lowStockCount = await Product.countDocuments({
      userId,
      $expr: { $lte: ['$currentStock', '$minimumStock'] },
    });

    // 6. Pending Payments & Dues
    // Customer Dues (Receivables)
    const pendingSales = await Sale.find({
      userId,
      paymentStatus: { $in: ['Pending', 'Partially Paid'] },
      dueAmount: { $gt: 0 },
    })
      .sort({ saleDate: -1 })
      .limit(5);

    const totalReceivablesAgg = await Customer.aggregate([
      { $match: { userId, outstandingBalance: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$outstandingBalance' } } },
    ]);
    const totalReceivables = totalReceivablesAgg[0]?.total || 0;

    // Supplier Dues (Payables)
    const pendingPurchases = await Purchase.find({
      userId,
      paymentStatus: { $in: ['Pending', 'Partially Paid'] },
      remainingAmount: { $gt: 0 },
    })
      .populate('supplier', 'name company phone')
      .sort({ purchaseDate: -1 })
      .limit(5);

    const totalPayablesAgg = await Supplier.aggregate([
      { $match: { userId, amountDue: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amountDue' } } },
    ]);
    const totalPayables = totalPayablesAgg[0]?.total || 0;

    // 7. Recent Sales for Activity Feed
    const recentSales = await Sale.find({ userId })
      .sort({ saleDate: -1 })
      .limit(5);

    // Check if new user with no business data yet
    const hasData = totalProductTypes > 0 || todaySalesCount > 0 || todayExpenseCount > 0;

    res.render('dashboard/index', {
      title: 'Dashboard',
      activeMenu: 'dashboard',
      currency,
      hasData,
      metrics: {
        todaySalesAmount,
        todaySalesCount,
        todayExpenseAmount,
        todayExpenseCount,
        todayGrossProfit,
        todayNetProfit,
        totalStockValue,
        totalPotentialRevenue,
        totalProductTypes,
        lowStockCount,
        totalReceivables,
        totalPayables,
      },
      lowStockItems,
      pendingPurchases,
      pendingSales,
      recentSales,
    });
  } catch (error) {
    console.error('[Dashboard Controller Error]', error);
    res.status(500).render('error', {
      title: 'Dashboard Error',
      statusCode: 500,
      message: 'Failed to calculate dashboard analytics. Please try again.',
      activeMenu: 'dashboard',
    });
  }
};

module.exports = {
  getDashboard,
};
