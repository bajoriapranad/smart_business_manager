const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const BusinessSettings = require('../models/BusinessSettings');

// Helper to calculate date filter
const getDateFilter = (timeframe) => {
  const now = new Date();
  if (timeframe === '7days') {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { $gte: start };
  } else if (timeframe === '30days') {
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { $gte: start };
  } else if (timeframe === '90days') {
    const start = new Date(now);
    start.setDate(now.getDate() - 90);
    start.setHours(0, 0, 0, 0);
    return { $gte: start };
  } else if (timeframe === 'this_year') {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    return { $gte: start };
  }
  return null; // 'all'
};

// 1. Main Business Analytics Dashboard
const getAnalyticsDashboard = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { timeframe = '30days' } = req.query;

    const dateFilter = getDateFilter(timeframe);
    const saleMatch = { userId };
    if (dateFilter) {
      saleMatch.saleDate = dateFilter;
    }

    const [
      salesSummaryAgg,
      paymentMethodAgg,
      dailyTrendAgg,
      hourlyAgg,
      productVelocityAgg,
      allProducts,
      customerSplitAgg,
      settings,
    ] = await Promise.all([
      // 1. Overall Sales Summary
      Sale.aggregate([
        { $match: saleMatch },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$finalAmount' },
            totalOrders: { $sum: 1 },
            totalCOGS: { $sum: '$costOfGoodsSold' },
            totalDiscount: { $sum: '$discountAmount' },
          },
        },
      ]),

      // 2. Payment Method Distribution
      Sale.aggregate([
        { $match: saleMatch },
        {
          $group: {
            _id: '$paymentMethod',
            revenue: { $sum: '$finalAmount' },
            orders: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
      ]),

      // 3. Daily Sales & Volume Trend
      Sale.aggregate([
        { $match: saleMatch },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$saleDate' } },
            revenue: { $sum: '$finalAmount' },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // 4. Peak Trading Hours (00-23)
      Sale.aggregate([
        { $match: saleMatch },
        {
          $group: {
            _id: { $hour: '$saleDate' },
            orders: { $sum: 1 },
            revenue: { $sum: '$finalAmount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // 5. Product Sales Velocity (Units sold in period)
      Sale.aggregate([
        { $match: saleMatch },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            unitsSold: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.subtotal' },
          },
        },
        { $sort: { unitsSold: -1 } },
      ]),

      // 6. All active products for stock velocity comparison
      Product.find({ userId }).populate('category'),

      // 7. Customer Type: Registered vs Walk-in
      Sale.aggregate([
        { $match: saleMatch },
        {
          $group: {
            _id: { $cond: [{ $ifNull: ['$customer', false] }, 'Registered Customer', 'Walk-in Customer'] },
            revenue: { $sum: '$finalAmount' },
            orders: { $sum: 1 },
          },
        },
      ]),

      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    const totalRevenue = salesSummaryAgg[0]?.totalRevenue || 0;
    const totalOrders = salesSummaryAgg[0]?.totalOrders || 0;
    const aov = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '0.00';
    const totalUnitsSold = productVelocityAgg.reduce((acc, p) => acc + p.unitsSold, 0);

    // Fast Moving Products (Top 5)
    const fastMovingProducts = productVelocityAgg.slice(0, 5);

    // Identify Slow-Moving and Dead Stock: products with currentStock > 0 that had 0 sales in period
    const soldProductIds = new Set(productVelocityAgg.map((p) => p._id.toString()));
    const deadStockProducts = allProducts
      .filter((prod) => prod.currentStock > 0 && !soldProductIds.has(prod._id.toString()))
      .map((prod) => ({
        ...prod.toObject(),
        stockValue: prod.currentStock * prod.purchasePrice,
      }))
      .sort((a, b) => b.stockValue - a.stockValue);

    const totalDeadStockValue = deadStockProducts.reduce((sum, p) => sum + p.stockValue, 0);

    // Format 24-hour array for Peak Trading Hours Chart
    const hoursMap = {};
    hourlyAgg.forEach((h) => {
      hoursMap[h._id] = { orders: h.orders, revenue: h.revenue };
    });

    const hourlyChartData = [];
    for (let i = 0; i < 24; i++) {
      const label = `${String(i).padStart(2, '0')}:00`;
      hourlyChartData.push({
        hour: label,
        orders: hoursMap[i]?.orders || 0,
        revenue: hoursMap[i]?.revenue || 0,
      });
    }

    // Payment Methods with Percentages
    const paymentMethods = paymentMethodAgg.map((pm) => ({
      method: pm._id || 'Other',
      revenue: pm.revenue,
      orders: pm.orders,
      percentage: totalRevenue > 0 ? ((pm.revenue / totalRevenue) * 100).toFixed(1) : '0.0',
    }));

    res.render('analytics/index', {
      title: 'Sales & Business Analytics',
      timeframe,
      currency,
      kpis: {
        totalRevenue,
        totalOrders,
        aov,
        totalUnitsSold,
        totalDeadStockValue,
        deadStockCount: deadStockProducts.length,
      },
      paymentMethods,
      dailyTrends: dailyTrendAgg,
      hourlyChartData,
      fastMovingProducts,
      deadStockProducts: deadStockProducts.slice(0, 5),
      customerSplit: customerSplitAgg,
      activeMenu: 'analytics',
    });
  } catch (error) {
    console.error('[Analytics Controller] getAnalyticsDashboard error:', error);
    req.flash('error_msg', 'Failed to load sales analytics.');
    res.redirect('/dashboard');
  }
};

module.exports = {
  getAnalyticsDashboard,
};
