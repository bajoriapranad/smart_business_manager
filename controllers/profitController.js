const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const Staff = require('../models/Staff');
const Product = require('../models/Product');
const Category = require('../models/Category');
const BusinessSettings = require('../models/BusinessSettings');

// Helper to compute date range filter
const getDateFilter = (timeframe, startDate, endDate) => {
  const now = new Date();
  if (timeframe === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  } else if (timeframe === 'this_week') {
    const day = now.getDay() || 7;
    const start = new Date(now);
    start.setDate(now.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  } else if (timeframe === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  } else if (timeframe === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  } else if (timeframe === 'this_year') {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  } else if (timeframe === 'custom' && startDate && endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }
  return null;
};

// 1. Main Profit Analyser & Margin Intelligence Dashboard
const getProfitDashboard = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { timeframe = 'this_month', startDate, endDate } = req.query;

    const dateFilter = getDateFilter(timeframe, startDate, endDate);

    const salesMatch = { userId };
    const expenseMatch = { userId };
    if (dateFilter) {
      salesMatch.saleDate = dateFilter;
      expenseMatch.date = dateFilter;
    }

    const [
      salesAgg,
      expenseTotalAgg,
      expenseCategoryAgg,
      activeStaff,
      recurringExpenses,
      productMarginsAgg,
      settings,
    ] = await Promise.all([
      // Sales Aggregate: Revenue, COGS, Gross Profit
      Sale.aggregate([
        { $match: salesMatch },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$finalAmount' },
            totalCOGS: { $sum: '$costOfGoodsSold' },
            totalGrossProfit: { $sum: '$grossProfit' },
            totalSalesCount: { $sum: 1 },
          },
        },
      ]),

      // Total Operating Expenses in timeframe
      Expense.aggregate([
        { $match: expenseMatch },
        {
          $group: {
            _id: null,
            totalOpex: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),

      // OPEX Breakdown by category
      Expense.aggregate([
        { $match: expenseMatch },
        {
          $group: {
            _id: '$category',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),

      // Fixed Staff Salaries
      Staff.find({ userId, status: 'Active' }),

      // Recurring overhead expenses (Rent, Internet, etc.)
      Expense.find({ userId, recurring: true }),

      // Product Level Margins
      Sale.aggregate([
        { $match: salesMatch },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            unitsSold: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.subtotal' },
            cost: { $sum: { $multiply: ['$items.purchasePrice', '$items.quantity'] } },
          },
        },
        {
          $project: {
            name: 1,
            unitsSold: 1,
            revenue: 1,
            cost: 1,
            grossProfit: { $subtract: ['$revenue', '$cost'] },
            marginPercent: {
              $cond: [
                { $gt: ['$revenue', 0] },
                { $multiply: [{ $divide: [{ $subtract: ['$revenue', '$cost'] }, '$revenue'] }, 100] },
                0,
              ],
            },
          },
        },
        { $sort: { grossProfit: -1 } },
      ]),

      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    // Primary P&L Figures
    const totalRevenue = salesAgg[0]?.totalRevenue || 0;
    const totalCOGS = salesAgg[0]?.totalCOGS || 0;
    const grossProfit = totalRevenue - totalCOGS;
    const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const totalOpex = expenseTotalAgg[0]?.totalOpex || 0;
    const netProfit = grossProfit - totalOpex;
    const netMarginPercent = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    const salesCount = salesAgg[0]?.totalSalesCount || 0;

    // Breakeven Math
    const committedSalaryCost = activeStaff.reduce((sum, s) => sum + s.salary, 0);
    const recurringExpenseCost = recurringExpenses.reduce((sum, e) => sum + e.amount, 0);
    const monthlyFixedOverhead = committedSalaryCost + recurringExpenseCost || totalOpex;

    let breakevenRevenue = 0;
    if (grossMarginPercent > 0) {
      breakevenRevenue = monthlyFixedOverhead / (grossMarginPercent / 100);
    }
    const breakevenProgress =
      breakevenRevenue > 0 ? Math.min(250, (totalRevenue / breakevenRevenue) * 100).toFixed(1) : 0;

    // Product Intelligence: Top 5 and Watchlist
    const topProducts = productMarginsAgg.slice(0, 5);
    const lowMarginProducts = productMarginsAgg.filter((p) => p.marginPercent < 15 && p.unitsSold > 0);

    // Populate Category breakdown
    // Map product IDs to their categories
    const productIds = productMarginsAgg.map((p) => p._id);
    const productsInSales = await Product.find({ _id: { $in: productIds } }).populate('category');

    const categoryProfitMap = {};
    productsInSales.forEach((prod) => {
      const catName = prod.category?.name || 'Uncategorized';
      const prodStats = productMarginsAgg.find((p) => p._id.toString() === prod._id.toString());
      if (prodStats) {
        if (!categoryProfitMap[catName]) {
          categoryProfitMap[catName] = { name: catName, revenue: 0, profit: 0, units: 0 };
        }
        categoryProfitMap[catName].revenue += prodStats.revenue;
        categoryProfitMap[catName].profit += prodStats.grossProfit;
        categoryProfitMap[catName].units += prodStats.unitsSold;
      }
    });

    const categoryBreakdown = Object.values(categoryProfitMap)
      .map((cat) => ({
        ...cat,
        marginPercent: cat.revenue > 0 ? ((cat.profit / cat.revenue) * 100).toFixed(1) : '0.0',
        profitSharePercent: grossProfit > 0 ? ((cat.profit / grossProfit) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.profit - a.profit);

    res.render('profit/index', {
      title: 'Profit Analyser & Margin Intelligence',
      timeframe,
      startDate: startDate || '',
      endDate: endDate || '',
      currency,
      pnl: {
        totalRevenue,
        totalCOGS,
        grossProfit,
        grossMarginPercent: grossMarginPercent.toFixed(1),
        totalOpex,
        netProfit,
        netMarginPercent: netMarginPercent.toFixed(1),
        salesCount,
      },
      breakeven: {
        monthlyFixedOverhead,
        breakevenRevenue,
        breakevenProgress,
        isBreakevenAchieved: totalRevenue >= breakevenRevenue && breakevenRevenue > 0,
      },
      topProducts,
      lowMarginProducts,
      categoryBreakdown,
      expenseCategories: expenseCategoryAgg,
      activeMenu: 'profit',
    });
  } catch (error) {
    console.error('[Profit Controller] getProfitDashboard error:', error);
    req.flash('error_msg', 'Failed to load profit analytics.');
    res.redirect('/dashboard');
  }
};

module.exports = {
  getProfitDashboard,
};
