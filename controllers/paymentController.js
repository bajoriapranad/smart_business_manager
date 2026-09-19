const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Staff = require('../models/Staff');
const StaffPayment = require('../models/StaffPayment');
const Expense = require('../models/Expense');
const ElectricityBill = require('../models/ElectricityBill');
const BusinessSettings = require('../models/BusinessSettings');

// Helper for current month YYYY-MM
const getCurrentMonthStr = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// 1. Unified Liquidity & Due Reminders Dashboard
const getPaymentsHub = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const now = new Date();

    // Auto-update pending expenses & electricity past due date to Overdue
    await Promise.all([
      Expense.updateMany(
        { userId, paymentStatus: 'Pending', dueDate: { $lt: now } },
        { $set: { paymentStatus: 'Overdue' } }
      ),
      ElectricityBill.updateMany(
        { userId, paymentStatus: 'Pending', dueDate: { $lt: now } },
        { $set: { paymentStatus: 'Overdue' } }
      ),
    ]);

    const currentMonth = getCurrentMonthStr();
    const activeTab = req.query.tab || 'overview';

    const [
      customersWithDue,
      suppliersWithDue,
      activeStaff,
      staffPaymentsThisMonth,
      pendingExpenses,
      pendingElectricity,
      settings,
    ] = await Promise.all([
      Customer.find({ userId, outstandingBalance: { $gt: 0 } }).sort({ outstandingBalance: -1 }),
      Supplier.find({ userId, amountDue: { $gt: 0 } }).sort({ amountDue: -1 }),
      Staff.find({ userId, status: 'Active' }),
      StaffPayment.find({ userId, forMonth: currentMonth }),
      Expense.find({ userId, paymentStatus: { $in: ['Pending', 'Overdue'] } }).sort({ dueDate: 1, date: -1 }),
      ElectricityBill.find({ userId, paymentStatus: { $in: ['Pending', 'Overdue'] } }).sort({ dueDate: 1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';
    const businessName = settings?.businessName || 'Our Business';

    // Filter staff who haven't received salary for current month
    const paidStaffIds = new Set(staffPaymentsThisMonth.map((p) => p.staff.toString()));
    const unpaidStaff = activeStaff.filter((s) => !paidStaffIds.has(s._id.toString()));

    // Accounts Receivable Aggregates
    const totalReceivables = customersWithDue.reduce((acc, c) => acc + c.outstandingBalance, 0);

    // Accounts Payable Aggregates
    const supplierDues = suppliersWithDue.reduce((acc, s) => acc + s.amountDue, 0);
    const payrollDues = unpaidStaff.reduce((acc, s) => acc + s.salary, 0);
    const expenseDues = pendingExpenses.reduce((acc, e) => acc + e.amount, 0);
    const electricityDues = pendingElectricity.reduce((acc, el) => acc + el.billAmount, 0);

    const totalPayables = supplierDues + payrollDues + expenseDues + electricityDues;
    const netWorkingCapital = totalReceivables - totalPayables;

    // Urgent Overdue Count
    const overdueExpensesCount = pendingExpenses.filter((e) => e.paymentStatus === 'Overdue').length;
    const overdueElectricityCount = pendingElectricity.filter((el) => el.paymentStatus === 'Overdue').length;
    const totalOverdueCount = overdueExpensesCount + overdueElectricityCount;

    // Omnichannel WhatsApp Reminder generation for each customer
    const customersWithReminders = customersWithDue.map((cust) => {
      const rawPhone = cust.phone ? cust.phone.replace(/\D/g, '') : '';
      const phoneWithCode = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
      const message = `Hello ${cust.name}, this is a gentle reminder from ${businessName}. You have an outstanding credit balance of ${currency}${cust.outstandingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Kindly arrange settlement when convenient. Thank you!`;
      const whatsappUrl = `https://wa.me/${phoneWithCode}?text=${encodeURIComponent(message)}`;

      return {
        ...cust.toObject(),
        whatsappUrl,
        reminderText: message,
      };
    });

    res.render('payments/index', {
      title: 'Payments & Due Reminders Hub',
      activeTab,
      currency,
      businessName,
      currentMonth,
      kpis: {
        totalReceivables,
        totalPayables,
        netWorkingCapital,
        totalOverdueCount,
        customerCount: customersWithDue.length,
        supplierDues,
        payrollDues,
        expenseDues,
        electricityDues,
      },
      customers: customersWithReminders,
      suppliers: suppliersWithDue,
      unpaidStaff,
      expenses: pendingExpenses,
      electricity: pendingElectricity,
      activeMenu: 'payments',
    });
  } catch (error) {
    console.error('[Payments Hub Controller] getPaymentsHub error:', error);
    req.flash('error_msg', 'Failed to load payments hub.');
    res.redirect('/dashboard');
  }
};

// 2. Settle Customer Credit Dues
const postCustomerPay = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;
    const amount = parseFloat(req.body.amount);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid customer ID.');
      return res.redirect('/payments?tab=receivables');
    }

    const customer = await Customer.findOne({ _id: id, userId });
    if (!customer) {
      req.flash('error_msg', 'Customer profile not found.');
      return res.redirect('/payments?tab=receivables');
    }

    if (customer.outstandingBalance <= 0) {
      req.flash('error_msg', 'This customer has no outstanding balance.');
      return res.redirect('/payments?tab=receivables');
    }

    const paymentAmount = isNaN(amount) || amount <= 0 ? customer.outstandingBalance : amount;
    const actualPay = Math.min(paymentAmount, customer.outstandingBalance);

    customer.outstandingBalance = Math.max(0, customer.outstandingBalance - actualPay);
    await customer.save();

    req.flash(
      'success_msg',
      `Payment of ₹${actualPay.toFixed(2)} received from ${customer.name}. Remaining balance: ₹${customer.outstandingBalance.toFixed(2)}.`
    );
    res.redirect('/payments?tab=receivables');
  } catch (error) {
    console.error('[Payments Controller] postCustomerPay error:', error);
    req.flash('error_msg', 'Failed to record customer payment.');
    res.redirect('/payments?tab=receivables');
  }
};

// 3. Settle Supplier Payable
const postSupplierPay = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;
    const amount = parseFloat(req.body.amount);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid supplier ID.');
      return res.redirect('/payments?tab=payables');
    }

    const supplier = await Supplier.findOne({ _id: id, userId });
    if (!supplier) {
      req.flash('error_msg', 'Supplier record not found.');
      return res.redirect('/payments?tab=payables');
    }

    const paymentAmount = isNaN(amount) || amount <= 0 ? supplier.amountDue : amount;
    const actualPay = Math.min(paymentAmount, supplier.amountDue);

    supplier.amountDue = Math.max(0, supplier.amountDue - actualPay);
    supplier.amountPaid = (supplier.amountPaid || 0) + actualPay;
    await supplier.save();

    req.flash(
      'success_msg',
      `Payment of ₹${actualPay.toFixed(2)} settled with supplier "${supplier.name}". Remaining payable: ₹${supplier.amountDue.toFixed(2)}.`
    );
    res.redirect('/payments?tab=payables');
  } catch (error) {
    console.error('[Payments Controller] postSupplierPay error:', error);
    req.flash('error_msg', 'Failed to settle supplier payable.');
    res.redirect('/payments?tab=payables');
  }
};

// 4. Settle Pending Operating Expense
const postExpensePay = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid expense ID.');
      return res.redirect('/payments?tab=payables');
    }

    const expense = await Expense.findOne({ _id: id, userId });
    if (!expense) {
      req.flash('error_msg', 'Expense record not found.');
      return res.redirect('/payments?tab=payables');
    }

    expense.paymentStatus = 'Paid';
    expense.date = new Date();
    await expense.save();

    req.flash('success_msg', `Operating expense "${expense.title}" has been settled and marked as Paid.`);
    res.redirect('/payments?tab=payables');
  } catch (error) {
    console.error('[Payments Controller] postExpensePay error:', error);
    req.flash('error_msg', 'Failed to settle operating expense.');
    res.redirect('/payments?tab=payables');
  }
};

// 5. Settle Pending Electricity Bill
const postElectricityPay = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid bill ID.');
      return res.redirect('/payments?tab=payables');
    }

    const bill = await ElectricityBill.findOne({ _id: id, userId });
    if (!bill) {
      req.flash('error_msg', 'Electricity bill not found.');
      return res.redirect('/payments?tab=payables');
    }

    bill.paymentStatus = 'Paid';
    bill.paidDate = new Date();
    await bill.save();

    // Auto-sync into Expense
    const existingExpense = await Expense.findOne({
      userId,
      notes: { $regex: `ElectricityBill:${bill._id}` },
    });

    if (!existingExpense) {
      await Expense.create({
        userId,
        title: `Electricity Bill: ${bill.billingMonth} (Meter: ${bill.meterNumber})`,
        category: 'Electricity',
        amount: bill.billAmount,
        date: bill.paidDate,
        paymentStatus: 'Paid',
        recurring: true,
        notes: `Auto-synced from ElectricityBill:${bill._id}`,
      });
    }

    req.flash(
      'success_msg',
      `Electricity bill for ${bill.billingMonth} marked as Paid and synchronized with Expenses.`
    );
    res.redirect('/payments?tab=payables');
  } catch (error) {
    console.error('[Payments Controller] postElectricityPay error:', error);
    req.flash('error_msg', 'Failed to settle electricity bill.');
    res.redirect('/payments?tab=payables');
  }
};

module.exports = {
  getPaymentsHub,
  postCustomerPay,
  postSupplierPay,
  postExpensePay,
  postElectricityPay,
};
