const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
const BusinessSettings = require('../models/BusinessSettings');

// Helper: Escape and generate CSV content with UTF-8 BOM
const generateCSV = (headers, rows) => {
  const escapeCell = (cell) => {
    if (cell === null || cell === undefined) return '';
    const str = String(cell);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ].join('\r\n');

  return '\uFEFF' + csvContent;
};

// Date range parser
const getDateRangeFilter = (timeframe, customStart, customEnd) => {
  const now = new Date();
  if (timeframe === '7days') {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { $gte: start, $lte: now };
  } else if (timeframe === '30days') {
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { $gte: start, $lte: now };
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
  } else if (timeframe === 'custom' && customStart && customEnd) {
    const start = new Date(customStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }
  return null; // 'all'
};

// 1. Reports Portal Hub
const getReportsHub = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const [salesCount, productsCount, customersCount, purchasesCount, expensesCount, settings] =
      await Promise.all([
        Sale.countDocuments({ userId }),
        Product.countDocuments({ userId }),
        Customer.countDocuments({ userId }),
        Purchase.countDocuments({ userId }),
        Expense.countDocuments({ userId }),
        BusinessSettings.findOne({ userId }),
      ]);

    const currency = settings?.currency || '₹';

    res.render('reports/index', {
      title: 'Reports & Export Engine',
      counts: {
        sales: salesCount,
        inventory: productsCount,
        customers: customersCount,
        purchases: purchasesCount,
        expenses: expensesCount,
      },
      currency,
      activeMenu: 'reports',
    });
  } catch (error) {
    console.error('[Reports Controller] getReportsHub error:', error);
    req.flash('error_msg', 'Failed to load reports hub.');
    res.redirect('/dashboard');
  }
};

// 2. Sales Register Report (View & CSV)
const getSalesReport = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { timeframe = 'this_month', startDate, endDate, format } = req.query;

    const dateFilter = getDateRangeFilter(timeframe, startDate, endDate);
    const query = { userId };
    if (dateFilter) query.saleDate = dateFilter;

    const [sales, settings] = await Promise.all([
      Sale.find(query).sort({ saleDate: -1, createdAt: -1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    const totals = sales.reduce(
      (acc, s) => {
        acc.revenue += s.finalAmount || 0;
        acc.cogs += s.costOfGoodsSold || 0;
        acc.profit += s.grossProfit || 0;
        acc.discount += s.discountAmount || 0;
        return acc;
      },
      { revenue: 0, cogs: 0, profit: 0, discount: 0 }
    );
    totals.margin = totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : '0.0';

    // CSV Download Trigger
    if (format === 'csv') {
      const headers = [
        'Invoice Number',
        'Date',
        'Customer Name',
        'Customer Phone',
        'Items Count',
        'Subtotal',
        'Discount',
        'Final Amount',
        'COGS',
        'Gross Profit',
        'Payment Method',
        'Payment Status',
      ];
      const rows = sales.map((s) => [
        s.invoiceNumber,
        new Date(s.saleDate).toISOString().split('T')[0],
        s.customerName,
        s.customerPhone || '',
        s.items ? s.items.length : 0,
        s.subtotalAmount.toFixed(2),
        s.discountAmount.toFixed(2),
        s.finalAmount.toFixed(2),
        s.costOfGoodsSold.toFixed(2),
        s.grossProfit.toFixed(2),
        s.paymentMethod,
        s.paymentStatus,
      ]);

      const csv = generateCSV(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=sales_register_${timeframe}_${Date.now()}.csv`
      );
      return res.send(csv);
    }

    res.render('reports/sales', {
      title: 'Sales Register Report',
      sales,
      totals,
      timeframe,
      startDate: startDate || '',
      endDate: endDate || '',
      currency,
      activeMenu: 'reports',
    });
  } catch (error) {
    console.error('[Reports Controller] getSalesReport error:', error);
    req.flash('error_msg', 'Failed to generate sales report.');
    res.redirect('/reports');
  }
};

// 3. Inventory Valuation & Stock Audit Report (View & CSV)
const getInventoryReport = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { format } = req.query;

    const [products, settings] = await Promise.all([
      Product.find({ userId }).populate('category').sort({ name: 1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    const totals = products.reduce(
      (acc, p) => {
        const costVal = p.currentStock * p.purchasePrice;
        const retailVal = p.currentStock * p.sellingPrice;
        acc.totalUnits += p.currentStock;
        acc.costValue += costVal;
        acc.retailValue += retailVal;
        acc.potentialProfit += retailVal - costVal;
        return acc;
      },
      { totalUnits: 0, costValue: 0, retailValue: 0, potentialProfit: 0 }
    );
    totals.margin = totals.retailValue > 0 ? ((totals.potentialProfit / totals.retailValue) * 100).toFixed(1) : '0.0';

    if (format === 'csv') {
      const headers = [
        'SKU',
        'Product Name',
        'Category',
        'Current Stock',
        'Unit',
        'Cost Price',
        'Selling Price',
        'Total Cost Value',
        'Total Retail Value',
        'Potential Margin %',
      ];
      const rows = products.map((p) => {
        const costVal = p.currentStock * p.purchasePrice;
        const retailVal = p.currentStock * p.sellingPrice;
        const margin = retailVal > 0 ? (((retailVal - costVal) / retailVal) * 100).toFixed(1) : '0.0';
        return [
          p.sku || '',
          p.name,
          p.category?.name || 'General',
          p.currentStock,
          p.unit || 'pcs',
          p.purchasePrice.toFixed(2),
          p.sellingPrice.toFixed(2),
          costVal.toFixed(2),
          retailVal.toFixed(2),
          `${margin}%`,
        ];
      });

      const csv = generateCSV(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=inventory_valuation_${Date.now()}.csv`
      );
      return res.send(csv);
    }

    res.render('reports/inventory', {
      title: 'Inventory Stock & Valuation Report',
      products,
      totals,
      currency,
      activeMenu: 'reports',
    });
  } catch (error) {
    console.error('[Reports Controller] getInventoryReport error:', error);
    req.flash('error_msg', 'Failed to generate inventory report.');
    res.redirect('/reports');
  }
};

// 4. Customer Receivables & Credit Ledger Report (View & CSV)
const getCustomerReport = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { format } = req.query;

    const [customers, settings] = await Promise.all([
      Customer.find({ userId }).sort({ outstandingBalance: -1, name: 1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    const totals = customers.reduce(
      (acc, c) => {
        acc.totalSpent += c.totalSpent || 0;
        acc.totalDue += c.outstandingBalance || 0;
        if (c.outstandingBalance > 0) acc.debtorCount += 1;
        return acc;
      },
      { totalSpent: 0, totalDue: 0, debtorCount: 0 }
    );

    if (format === 'csv') {
      const headers = [
        'Customer Name',
        'Phone Number',
        'Email',
        'Loyalty Tier',
        'Discount %',
        'Total Lifetime Spent',
        'Outstanding Balance Due',
      ];
      const rows = customers.map((c) => [
        c.name,
        c.phone || '',
        c.email || '',
        c.loyaltyTier || 'Standard',
        c.discountPercentage || 0,
        (c.totalSpent || 0).toFixed(2),
        (c.outstandingBalance || 0).toFixed(2),
      ]);

      const csv = generateCSV(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=customer_receivables_${Date.now()}.csv`
      );
      return res.send(csv);
    }

    res.render('reports/customers', {
      title: 'Customer Credit & Receivables Report',
      customers,
      totals,
      currency,
      activeMenu: 'reports',
    });
  } catch (error) {
    console.error('[Reports Controller] getCustomerReport error:', error);
    req.flash('error_msg', 'Failed to generate customer report.');
    res.redirect('/reports');
  }
};

// 5. Supplier Purchases & Payables Report (View & CSV)
const getPurchaseReport = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { timeframe = 'this_month', startDate, endDate, format } = req.query;

    const dateFilter = getDateRangeFilter(timeframe, startDate, endDate);
    const query = { userId };
    if (dateFilter) query.purchaseDate = dateFilter;

    const [purchases, settings] = await Promise.all([
      Purchase.find(query).populate('supplier').sort({ purchaseDate: -1, createdAt: -1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    const totals = purchases.reduce(
      (acc, p) => {
        acc.totalPurchases += p.totalAmount || 0;
        acc.totalPaid += p.paidAmount || 0;
        acc.totalDue += p.remainingAmount || 0;
        return acc;
      },
      { totalPurchases: 0, totalPaid: 0, totalDue: 0 }
    );

    if (format === 'csv') {
      const headers = [
        'Purchase Invoice #',
        'Date',
        'Supplier Name',
        'Supplier Phone',
        'Items Count',
        'Total Amount',
        'Paid Amount',
        'Balance Due',
        'Payment Status',
      ];
      const rows = purchases.map((p) => [
        p.invoiceNumber,
        new Date(p.purchaseDate).toISOString().split('T')[0],
        p.supplier ? p.supplier.name : 'Unknown',
        p.supplier ? p.supplier.phone || '' : '',
        p.items ? p.items.length : 0,
        p.totalAmount.toFixed(2),
        p.paidAmount.toFixed(2),
        p.remainingAmount.toFixed(2),
        p.paymentStatus,
      ]);

      const csv = generateCSV(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=purchases_register_${Date.now()}.csv`
      );
      return res.send(csv);
    }

    res.render('reports/purchases', {
      title: 'Supplier Purchases & Payables Report',
      purchases,
      totals,
      timeframe,
      startDate: startDate || '',
      endDate: endDate || '',
      currency,
      activeMenu: 'reports',
    });
  } catch (error) {
    console.error('[Reports Controller] getPurchaseReport error:', error);
    req.flash('error_msg', 'Failed to generate purchases report.');
    res.redirect('/reports');
  }
};

// 6. Operating Expenses & Tax Audit Report (View & CSV)
const getExpenseReport = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { timeframe = 'this_month', startDate, endDate, format } = req.query;

    const dateFilter = getDateRangeFilter(timeframe, startDate, endDate);
    const query = { userId };
    if (dateFilter) query.date = dateFilter;

    const [expenses, settings] = await Promise.all([
      Expense.find(query).sort({ date: -1, createdAt: -1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    const totals = expenses.reduce(
      (acc, e) => {
        acc.totalExpense += e.amount || 0;
        if (e.paymentStatus === 'Paid') acc.paidExpense += e.amount || 0;
        else acc.dueExpense += e.amount || 0;
        return acc;
      },
      { totalExpense: 0, paidExpense: 0, dueExpense: 0 }
    );

    if (format === 'csv') {
      const headers = [
        'Expense Title',
        'Category',
        'Amount',
        'Expense Date',
        'Due Date',
        'Payment Status',
        'Recurring',
        'Notes',
      ];
      const rows = expenses.map((e) => [
        e.title,
        e.category,
        e.amount.toFixed(2),
        new Date(e.date).toISOString().split('T')[0],
        e.dueDate ? new Date(e.dueDate).toISOString().split('T')[0] : '',
        e.paymentStatus,
        e.recurring ? 'Yes' : 'No',
        e.notes || '',
      ]);

      const csv = generateCSV(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=operating_expenses_${Date.now()}.csv`
      );
      return res.send(csv);
    }

    res.render('reports/expenses', {
      title: 'Operating Expenses & Tax Report',
      expenses,
      totals,
      timeframe,
      startDate: startDate || '',
      endDate: endDate || '',
      currency,
      activeMenu: 'reports',
    });
  } catch (error) {
    console.error('[Reports Controller] getExpenseReport error:', error);
    req.flash('error_msg', 'Failed to generate expense report.');
    res.redirect('/reports');
  }
};

// 7. Printable Financial Statement
const printStatement = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { type, timeframe = 'this_month', startDate, endDate } = req.query;

    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';
    const businessName = settings?.businessName || 'Our Business';
    const dateFilter = getDateRangeFilter(timeframe, startDate, endDate);

    let reportTitle = 'Financial Audit Statement';
    let dataItems = [];
    let summaryCards = [];

    if (type === 'sales') {
      reportTitle = 'Sales Register Statement';
      const query = { userId };
      if (dateFilter) query.saleDate = dateFilter;
      const sales = await Sale.find(query).sort({ saleDate: -1 });
      const rev = sales.reduce((sum, s) => sum + s.finalAmount, 0);
      const profit = sales.reduce((sum, s) => sum + s.grossProfit, 0);
      summaryCards = [
        { label: 'Total Invoices', value: sales.length },
        { label: 'Gross Revenue', value: `${currency}${rev.toFixed(2)}` },
        { label: 'Gross Profit', value: `${currency}${profit.toFixed(2)}` },
      ];
      dataItems = sales.map((s) => ({
        col1: s.invoiceNumber,
        col2: new Date(s.saleDate).toISOString().split('T')[0],
        col3: s.customerName,
        col4: s.paymentMethod,
        col5: `${currency}${s.finalAmount.toFixed(2)}`,
      }));
    } else if (type === 'inventory') {
      reportTitle = 'Inventory Valuation Statement';
      const products = await Product.find({ userId }).populate('category').sort({ name: 1 });
      const costVal = products.reduce((sum, p) => sum + p.currentStock * p.purchasePrice, 0);
      const retailVal = products.reduce((sum, p) => sum + p.currentStock * p.sellingPrice, 0);
      summaryCards = [
        { label: 'Total SKUs', value: products.length },
        { label: 'Valuation (Cost)', value: `${currency}${costVal.toFixed(2)}` },
        { label: 'Valuation (Retail)', value: `${currency}${retailVal.toFixed(2)}` },
      ];
      dataItems = products.map((p) => ({
        col1: p.sku || 'N/A',
        col2: p.name,
        col3: p.category?.name || 'General',
        col4: `${p.currentStock} ${p.unit || 'pcs'}`,
        col5: `${currency}${(p.currentStock * p.purchasePrice).toFixed(2)}`,
      }));
    } else {
      // Default to sales
      reportTitle = 'General Business Statement';
    }

    res.render('reports/print_statement', {
      reportTitle,
      businessName,
      currency,
      generatedAt: new Date().toLocaleString('en-IN'),
      summaryCards,
      headers: ['Ref / SKU', 'Date / Description', 'Party / Category', 'Type / Quantity', 'Amount / Valuation'],
      dataItems,
      layout: false, // Clean printable standalone layout
    });
  } catch (error) {
    console.error('[Reports Controller] printStatement error:', error);
    res.status(500).send('Failed to generate printable statement.');
  }
};

module.exports = {
  getReportsHub,
  getSalesReport,
  getInventoryReport,
  getCustomerReport,
  getPurchaseReport,
  getExpenseReport,
  printStatement,
};
