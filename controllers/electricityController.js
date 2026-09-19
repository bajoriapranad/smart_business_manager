const mongoose = require('mongoose');
const ElectricityBill = require('../models/ElectricityBill');
const Expense = require('../models/Expense');
const BusinessSettings = require('../models/BusinessSettings');

// Helper to get current YYYY-MM
const getCurrentMonthStr = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// 1. Directory of Electricity Bills & Energy Analytics
const getElectricityBills = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    // Auto-update pending bills that are past due date
    const now = new Date();
    await ElectricityBill.updateMany(
      {
        userId,
        paymentStatus: 'Pending',
        dueDate: { $lt: now },
      },
      { $set: { paymentStatus: 'Overdue' } }
    );

    const { billingMonth, paymentStatus, meterNumber, search } = req.query;
    const query = { userId };

    if (billingMonth && billingMonth.trim()) {
      query.billingMonth = { $regex: billingMonth.trim() };
    }

    if (paymentStatus && ['Paid', 'Pending', 'Overdue'].includes(paymentStatus)) {
      query.paymentStatus = paymentStatus;
    }

    if (meterNumber && meterNumber.trim()) {
      query.meterNumber = { $regex: meterNumber.trim(), $options: 'i' };
    }

    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      query.$or = [{ meterNumber: regex }, { billingMonth: regex }, { notes: regex }];
    }

    const [bills, kpiAgg] = await Promise.all([
      ElectricityBill.find(query).sort({ billingMonth: -1, createdAt: -1 }),
      ElectricityBill.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            totalBilled: { $sum: '$billAmount' },
            totalUnits: { $sum: '$unitsConsumed' },
            paidAmount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$billAmount', 0] },
            },
            pendingAmount: {
              $sum: {
                $cond: [{ $in: ['$paymentStatus', ['Pending', 'Overdue']] }, '$billAmount', 0],
              },
            },
            overdueCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'Overdue'] }, 1, 0] },
            },
            totalCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const kpis = {
      totalBilled: kpiAgg[0]?.totalBilled || 0,
      totalUnits: kpiAgg[0]?.totalUnits || 0,
      paidAmount: kpiAgg[0]?.paidAmount || 0,
      pendingAmount: kpiAgg[0]?.pendingAmount || 0,
      overdueCount: kpiAgg[0]?.overdueCount || 0,
      totalCount: kpiAgg[0]?.totalCount || 0,
      avgCostPerUnit:
        kpiAgg[0]?.totalUnits > 0
          ? (kpiAgg[0].totalBilled / kpiAgg[0].totalUnits).toFixed(2)
          : '0.00',
    };

    // Compute month-over-month unit consumption trend for each bill
    const billsWithTrend = bills.map((bill, index) => {
      const prevBill = bills.slice(index + 1).find((b) => b.meterNumber === bill.meterNumber);
      let diffPercent = null;
      if (prevBill && prevBill.unitsConsumed > 0) {
        diffPercent = (
          ((bill.unitsConsumed - prevBill.unitsConsumed) / prevBill.unitsConsumed) *
          100
        ).toFixed(1);
      }
      const costPerUnit =
        bill.unitsConsumed > 0 ? (bill.billAmount / bill.unitsConsumed).toFixed(2) : '0.00';
      return {
        ...bill.toObject(),
        diffPercent,
        costPerUnit,
      };
    });

    res.render('electricity/index', {
      title: 'Electricity & Utility Bills',
      bills: billsWithTrend,
      kpis,
      filters: {
        billingMonth: billingMonth || '',
        paymentStatus: paymentStatus || '',
        meterNumber: meterNumber || '',
        search: search || '',
      },
      currency,
      activeMenu: 'electricity',
    });
  } catch (error) {
    console.error('[Electricity Controller] getElectricityBills error:', error);
    req.flash('error_msg', 'Failed to retrieve electricity bills.');
    res.redirect('/dashboard');
  }
};

// 2. Render Form to Record New Bill
const getNewBill = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const [lastBill, settings] = await Promise.all([
      ElectricityBill.findOne({ userId }).sort({ billingMonth: -1, createdAt: -1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';
    const prefillMeter = lastBill ? lastBill.meterNumber : '';
    const prefillPreviousReading = lastBill ? lastBill.currentReading : 0;
    const defaultBillingMonth = getCurrentMonthStr();

    res.render('electricity/form', {
      title: 'Record Electricity Bill',
      bill: null,
      prefillMeter,
      prefillPreviousReading,
      defaultBillingMonth,
      currency,
      activeMenu: 'electricity',
    });
  } catch (error) {
    console.error('[Electricity Controller] getNewBill error:', error);
    req.flash('error_msg', 'Failed to load bill recording form.');
    res.redirect('/electricity');
  }
};

// 3. Process New Bill Recording & Automated Expense Sync
const postNewBill = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const {
      meterNumber,
      billingMonth,
      previousReading,
      currentReading,
      billAmount,
      dueDate,
      paymentStatus,
      paidDate,
      notes,
    } = req.body;

    if (!meterNumber || !meterNumber.trim()) {
      req.flash('error_msg', 'Meter number is required.');
      return res.redirect('/electricity/new');
    }

    if (!billingMonth || !billingMonth.trim()) {
      req.flash('error_msg', 'Billing month (YYYY-MM) is required.');
      return res.redirect('/electricity/new');
    }

    const prev = parseFloat(previousReading);
    const curr = parseFloat(currentReading);
    if (isNaN(prev) || prev < 0 || isNaN(curr) || curr < 0) {
      req.flash('error_msg', 'Valid non-negative meter readings are required.');
      return res.redirect('/electricity/new');
    }

    if (curr < prev) {
      req.flash('error_msg', 'Current meter reading cannot be less than previous reading.');
      return res.redirect('/electricity/new');
    }

    const amount = parseFloat(billAmount);
    if (isNaN(amount) || amount < 0) {
      req.flash('error_msg', 'Valid non-negative bill amount is required.');
      return res.redirect('/electricity/new');
    }

    if (!dueDate) {
      req.flash('error_msg', 'Payment due date is required.');
      return res.redirect('/electricity/new');
    }

    const unitsConsumed = curr - prev;
    let status = paymentStatus || 'Pending';
    const parsedDueDate = new Date(dueDate);
    const now = new Date();

    if (status === 'Pending' && parsedDueDate < now) {
      status = 'Overdue';
    }

    const bill = new ElectricityBill({
      userId,
      meterNumber: meterNumber.trim(),
      billingMonth: billingMonth.trim(),
      previousReading: prev,
      currentReading: curr,
      unitsConsumed,
      billAmount: amount,
      dueDate: parsedDueDate,
      paidDate: status === 'Paid' ? (paidDate ? new Date(paidDate) : new Date()) : undefined,
      paymentStatus: status,
      notes: notes ? notes.trim() : '',
    });

    await bill.save();

    // Automated Operating Expense Synchronization if bill is already Paid
    if (status === 'Paid') {
      const expense = new Expense({
        userId,
        title: `Electricity Bill: ${bill.billingMonth} (Meter: ${bill.meterNumber})`,
        category: 'Electricity',
        amount: bill.billAmount,
        date: bill.paidDate || bill.dueDate || new Date(),
        paymentStatus: 'Paid',
        recurring: true,
        notes: `Auto-synced from ElectricityBill:${bill._id}`,
      });
      await expense.save();
    }

    req.flash(
      'success_msg',
      `Electricity bill for ${bill.billingMonth} (${bill.unitsConsumed} units, ₹${bill.billAmount.toFixed(2)}) recorded successfully.`
    );
    res.redirect('/electricity');
  } catch (error) {
    console.error('[Electricity Controller] postNewBill error:', error);
    req.flash('error_msg', error.message || 'Failed to record electricity bill.');
    res.redirect('/electricity/new');
  }
};

// 4. Render Form to Edit Bill
const getEditBill = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid bill ID.');
      return res.redirect('/electricity');
    }

    const [bill, settings] = await Promise.all([
      ElectricityBill.findOne({ _id: id, userId }),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!bill) {
      req.flash('error_msg', 'Electricity bill not found.');
      return res.redirect('/electricity');
    }

    const currency = settings?.currency || '₹';

    res.render('electricity/form', {
      title: `Edit Bill: ${bill.billingMonth}`,
      bill,
      currency,
      activeMenu: 'electricity',
    });
  } catch (error) {
    console.error('[Electricity Controller] getEditBill error:', error);
    req.flash('error_msg', 'Failed to load bill for editing.');
    res.redirect('/electricity');
  }
};

// 5. Update Bill & Synchronize Linked Expense
const putBill = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;
    const {
      meterNumber,
      billingMonth,
      previousReading,
      currentReading,
      billAmount,
      dueDate,
      paymentStatus,
      paidDate,
      notes,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid bill ID.');
      return res.redirect('/electricity');
    }

    const bill = await ElectricityBill.findOne({ _id: id, userId });
    if (!bill) {
      req.flash('error_msg', 'Electricity bill not found.');
      return res.redirect('/electricity');
    }

    const prev = parseFloat(previousReading);
    const curr = parseFloat(currentReading);
    if (isNaN(prev) || prev < 0 || isNaN(curr) || curr < 0 || curr < prev) {
      req.flash('error_msg', 'Current reading must be greater than or equal to previous reading.');
      return res.redirect(`/electricity/${id}/edit`);
    }

    const amount = parseFloat(billAmount);
    if (isNaN(amount) || amount < 0) {
      req.flash('error_msg', 'Valid bill amount is required.');
      return res.redirect(`/electricity/${id}/edit`);
    }

    let status = paymentStatus || bill.paymentStatus;
    const parsedDueDate = new Date(dueDate);
    const now = new Date();

    if (status === 'Pending' && parsedDueDate < now) {
      status = 'Overdue';
    }

    const unitsConsumed = curr - prev;

    bill.meterNumber = meterNumber.trim();
    bill.billingMonth = billingMonth.trim();
    bill.previousReading = prev;
    bill.currentReading = curr;
    bill.unitsConsumed = unitsConsumed;
    bill.billAmount = amount;
    bill.dueDate = parsedDueDate;
    bill.paymentStatus = status;
    bill.notes = notes ? notes.trim() : '';

    if (status === 'Paid') {
      bill.paidDate = paidDate ? new Date(paidDate) : bill.paidDate || new Date();
    } else {
      bill.paidDate = undefined;
    }

    await bill.save();

    // Synchronize with linked Expense
    if (status === 'Paid') {
      const existingExpense = await Expense.findOne({
        userId,
        notes: { $regex: `ElectricityBill:${bill._id}` },
      });

      if (existingExpense) {
        existingExpense.title = `Electricity Bill: ${bill.billingMonth} (Meter: ${bill.meterNumber})`;
        existingExpense.amount = bill.billAmount;
        existingExpense.date = bill.paidDate || new Date();
        await existingExpense.save();
      } else {
        const expense = new Expense({
          userId,
          title: `Electricity Bill: ${bill.billingMonth} (Meter: ${bill.meterNumber})`,
          category: 'Electricity',
          amount: bill.billAmount,
          date: bill.paidDate || new Date(),
          paymentStatus: 'Paid',
          recurring: true,
          notes: `Auto-synced from ElectricityBill:${bill._id}`,
        });
        await expense.save();
      }
    } else {
      // If changed from Paid to Pending/Overdue, remove linked Expense
      await Expense.findOneAndDelete({
        userId,
        notes: { $regex: `ElectricityBill:${bill._id}` },
      });
    }

    req.flash('success_msg', `Electricity bill for ${bill.billingMonth} updated successfully.`);
    res.redirect('/electricity');
  } catch (error) {
    console.error('[Electricity Controller] putBill error:', error);
    req.flash('error_msg', error.message || 'Failed to update bill.');
    res.redirect(`/electricity/${req.params.id}/edit`);
  }
};

// 6. One-Click Mark as Paid
const postPayBill = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid bill ID.');
      return res.redirect('/electricity');
    }

    const bill = await ElectricityBill.findOne({ _id: id, userId });
    if (!bill) {
      req.flash('error_msg', 'Electricity bill not found.');
      return res.redirect('/electricity');
    }

    bill.paymentStatus = 'Paid';
    bill.paidDate = new Date();
    await bill.save();

    // Create or update linked expense
    const existingExpense = await Expense.findOne({
      userId,
      notes: { $regex: `ElectricityBill:${bill._id}` },
    });

    if (!existingExpense) {
      const expense = new Expense({
        userId,
        title: `Electricity Bill: ${bill.billingMonth} (Meter: ${bill.meterNumber})`,
        category: 'Electricity',
        amount: bill.billAmount,
        date: bill.paidDate,
        paymentStatus: 'Paid',
        recurring: true,
        notes: `Auto-synced from ElectricityBill:${bill._id}`,
      });
      await expense.save();
    }

    req.flash(
      'success_msg',
      `Electricity bill for ${bill.billingMonth} marked as Paid and synchronized with Operating Expenses.`
    );
    res.redirect('/electricity');
  } catch (error) {
    console.error('[Electricity Controller] postPayBill error:', error);
    req.flash('error_msg', 'Failed to settle electricity bill.');
    res.redirect('/electricity');
  }
};

// 7. Delete Bill & Rollback Synced Expense
const deleteBill = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid bill ID.');
      return res.redirect('/electricity');
    }

    const bill = await ElectricityBill.findOneAndDelete({ _id: id, userId });
    if (!bill) {
      req.flash('error_msg', 'Electricity bill not found.');
      return res.redirect('/electricity');
    }

    // Rollback linked expense if exists
    await Expense.findOneAndDelete({
      userId,
      notes: { $regex: `ElectricityBill:${id}` },
    });

    req.flash('success_msg', `Electricity bill for ${bill.billingMonth} removed successfully.`);
    res.redirect('/electricity');
  } catch (error) {
    console.error('[Electricity Controller] deleteBill error:', error);
    req.flash('error_msg', 'Failed to delete electricity bill.');
    res.redirect('/electricity');
  }
};

module.exports = {
  getElectricityBills,
  getNewBill,
  postNewBill,
  getEditBill,
  putBill,
  postPayBill,
  deleteBill,
};
