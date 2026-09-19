const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const BusinessSettings = require('../models/BusinessSettings');

const EXPENSE_CATEGORIES = [
  'Electricity',
  'Rent',
  'Salary',
  'Transport',
  'Internet',
  'Maintenance',
  'Marketing',
  'Packaging',
  'Repairs',
  'Taxes',
  'Miscellaneous',
  'Other',
];

// Helper to calculate date range based on preset
const getDateRangeFilter = (timeframe, customStart, customEnd) => {
  const now = new Date();
  if (timeframe === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  } else if (timeframe === 'week') {
    const day = now.getDay() || 7;
    const start = new Date(now);
    start.setDate(now.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  } else if (timeframe === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  } else if (timeframe === 'custom' && customStart && customEnd) {
    const start = new Date(customStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }
  return null;
};

// 1. List Expenses with Filters, Search, and KPI Analytics
const getExpenses = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    // Auto-update pending expenses that are overdue
    const now = new Date();
    await Expense.updateMany(
      {
        userId,
        paymentStatus: 'Pending',
        dueDate: { $lt: now },
      },
      { $set: { paymentStatus: 'Overdue' } }
    );

    const { category, paymentStatus, timeframe, search, recurring, startDate, endDate } = req.query;
    const query = { userId };

    if (category && EXPENSE_CATEGORIES.includes(category)) {
      query.category = category;
    }

    if (paymentStatus && ['Paid', 'Pending', 'Overdue'].includes(paymentStatus)) {
      query.paymentStatus = paymentStatus;
    }

    if (recurring === 'true') {
      query.recurring = true;
    } else if (recurring === 'false') {
      query.recurring = false;
    }

    const dateFilter = getDateRangeFilter(timeframe || 'all', startDate, endDate);
    if (dateFilter) {
      query.date = dateFilter;
    }

    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      query.$or = [{ title: regex }, { notes: regex }];
    }

    // KPI Aggregation based on the active date filter (or all if all)
    const kpiMatch = { userId };
    if (dateFilter) {
      kpiMatch.date = dateFilter;
    }

    const [expenses, kpiAgg, categoryAgg] = await Promise.all([
      Expense.find(query).sort({ date: -1, createdAt: -1 }),
      Expense.aggregate([
        { $match: kpiMatch },
        {
          $group: {
            _id: null,
            totalExpenses: { $sum: '$amount' },
            paidAmount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$amount', 0] },
            },
            pendingAmount: {
              $sum: {
                $cond: [{ $in: ['$paymentStatus', ['Pending', 'Overdue']] }, '$amount', 0],
              },
            },
            overdueCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'Overdue'] }, 1, 0] },
            },
            totalCount: { $sum: 1 },
          },
        },
      ]),
      Expense.aggregate([
        { $match: kpiMatch },
        {
          $group: {
            _id: '$category',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),
    ]);

    const kpis = {
      totalExpenses: kpiAgg[0]?.totalExpenses || 0,
      paidAmount: kpiAgg[0]?.paidAmount || 0,
      pendingAmount: kpiAgg[0]?.pendingAmount || 0,
      overdueCount: kpiAgg[0]?.overdueCount || 0,
      totalCount: kpiAgg[0]?.totalCount || 0,
    };

    // Calculate percentage breakdown for categories
    const categoriesWithShare = categoryAgg.map((cat) => ({
      name: cat._id,
      total: cat.total,
      count: cat.count,
      percentage: kpis.totalExpenses > 0 ? ((cat.total / kpis.totalExpenses) * 100).toFixed(1) : 0,
    }));

    res.render('expenses/index', {
      title: 'Operating Expenses',
      expenses,
      kpis,
      categoryBreakdown: categoriesWithShare,
      categories: EXPENSE_CATEGORIES,
      filters: {
        category: category || '',
        paymentStatus: paymentStatus || '',
        timeframe: timeframe || 'all',
        startDate: startDate || '',
        endDate: endDate || '',
        search: search || '',
        recurring: recurring || '',
      },
      currency,
      activeMenu: 'expenses',
    });
  } catch (error) {
    console.error('[Expense Controller] getExpenses error:', error);
    req.flash('error_msg', 'Failed to retrieve expense records.');
    res.redirect('/dashboard');
  }
};

// 2. Render Form to Create New Expense
const getNewExpense = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    res.render('expenses/form', {
      title: 'Record New Expense',
      expense: null,
      categories: EXPENSE_CATEGORIES,
      currency,
      activeMenu: 'expenses',
    });
  } catch (error) {
    console.error('[Expense Controller] getNewExpense error:', error);
    req.flash('error_msg', 'Failed to load expense form.');
    res.redirect('/expenses');
  }
};

// 3. Process New Expense Creation
const postNewExpense = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { title, category, amount, date, dueDate, paymentStatus, recurring, notes } = req.body;

    if (!title || !title.trim()) {
      req.flash('error_msg', 'Expense title is required.');
      return res.redirect('/expenses/new');
    }

    if (!category || !EXPENSE_CATEGORIES.includes(category)) {
      req.flash('error_msg', 'Valid expense category is required.');
      return res.redirect('/expenses/new');
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 0) {
      req.flash('error_msg', 'Valid non-negative amount is required.');
      return res.redirect('/expenses/new');
    }

    let status = paymentStatus || 'Paid';
    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    const now = new Date();

    if (status === 'Pending' && parsedDueDate && parsedDueDate < now) {
      status = 'Overdue';
    }

    const expense = new Expense({
      userId,
      title: title.trim(),
      category,
      amount: numAmount,
      date: date ? new Date(date) : new Date(),
      dueDate: parsedDueDate || undefined,
      paymentStatus: status,
      recurring: recurring === 'true' || recurring === 'on' || recurring === true,
      notes: notes ? notes.trim() : '',
    });

    await expense.save();
    req.flash('success_msg', `Expense "${expense.title}" recorded successfully.`);
    res.redirect('/expenses');
  } catch (error) {
    console.error('[Expense Controller] postNewExpense error:', error);
    req.flash('error_msg', error.message || 'Failed to record expense.');
    res.redirect('/expenses/new');
  }
};

// 4. Render Form to Edit Expense
const getEditExpense = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid expense ID.');
      return res.redirect('/expenses');
    }

    const [expense, settings] = await Promise.all([
      Expense.findOne({ _id: id, userId }),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!expense) {
      req.flash('error_msg', 'Expense record not found.');
      return res.redirect('/expenses');
    }

    const currency = settings?.currency || '₹';

    res.render('expenses/form', {
      title: `Edit: ${expense.title}`,
      expense,
      categories: EXPENSE_CATEGORIES,
      currency,
      activeMenu: 'expenses',
    });
  } catch (error) {
    console.error('[Expense Controller] getEditExpense error:', error);
    req.flash('error_msg', 'Failed to load expense for editing.');
    res.redirect('/expenses');
  }
};

// 5. Update Expense Record
const putExpense = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;
    const { title, category, amount, date, dueDate, paymentStatus, recurring, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid expense ID.');
      return res.redirect('/expenses');
    }

    const expense = await Expense.findOne({ _id: id, userId });
    if (!expense) {
      req.flash('error_msg', 'Expense record not found.');
      return res.redirect('/expenses');
    }

    if (!title || !title.trim()) {
      req.flash('error_msg', 'Expense title is required.');
      return res.redirect(`/expenses/${id}/edit`);
    }

    if (!category || !EXPENSE_CATEGORIES.includes(category)) {
      req.flash('error_msg', 'Valid expense category is required.');
      return res.redirect(`/expenses/${id}/edit`);
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 0) {
      req.flash('error_msg', 'Valid non-negative amount is required.');
      return res.redirect(`/expenses/${id}/edit`);
    }

    let status = paymentStatus || expense.paymentStatus;
    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    const now = new Date();

    if (status === 'Pending' && parsedDueDate && parsedDueDate < now) {
      status = 'Overdue';
    }

    expense.title = title.trim();
    expense.category = category;
    expense.amount = numAmount;
    expense.date = date ? new Date(date) : expense.date;
    expense.dueDate = parsedDueDate || undefined;
    expense.paymentStatus = status;
    expense.recurring = recurring === 'true' || recurring === 'on' || recurring === true;
    expense.notes = notes ? notes.trim() : '';

    await expense.save();
    req.flash('success_msg', `Expense "${expense.title}" updated successfully.`);
    res.redirect('/expenses');
  } catch (error) {
    console.error('[Expense Controller] putExpense error:', error);
    req.flash('error_msg', error.message || 'Failed to update expense.');
    res.redirect(`/expenses/${req.params.id}/edit`);
  }
};

// 6. One-Click Mark Pending Expense as Paid
const postMarkAsPaid = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid expense ID.');
      return res.redirect('/expenses');
    }

    const expense = await Expense.findOne({ _id: id, userId });
    if (!expense) {
      req.flash('error_msg', 'Expense record not found.');
      return res.redirect('/expenses');
    }

    expense.paymentStatus = 'Paid';
    await expense.save();

    req.flash('success_msg', `Expense "${expense.title}" has been marked as Paid.`);
    res.redirect('/expenses');
  } catch (error) {
    console.error('[Expense Controller] postMarkAsPaid error:', error);
    req.flash('error_msg', 'Failed to update expense payment status.');
    res.redirect('/expenses');
  }
};

// 7. Delete Expense Record
const deleteExpense = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid expense ID.');
      return res.redirect('/expenses');
    }

    const expense = await Expense.findOneAndDelete({ _id: id, userId });
    if (!expense) {
      req.flash('error_msg', 'Expense record not found.');
      return res.redirect('/expenses');
    }

    req.flash('success_msg', `Expense "${expense.title}" removed successfully.`);
    res.redirect('/expenses');
  } catch (error) {
    console.error('[Expense Controller] deleteExpense error:', error);
    req.flash('error_msg', 'Failed to delete expense record.');
    res.redirect('/expenses');
  }
};

module.exports = {
  getExpenses,
  getNewExpense,
  postNewExpense,
  getEditExpense,
  putExpense,
  postMarkAsPaid,
  deleteExpense,
  EXPENSE_CATEGORIES,
};
