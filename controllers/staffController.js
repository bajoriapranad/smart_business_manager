const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const StaffPayment = require('../models/StaffPayment');
const Expense = require('../models/Expense');
const BusinessSettings = require('../models/BusinessSettings');

// Helper to get YYYY-MM string
const getCurrentMonthStr = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// 1. List Staff Members with Filters and Payroll KPIs
const getStaffList = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    const { search, status } = req.query;
    const query = { userId };

    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { position: searchRegex },
      ];
    }

    if (status && ['Active', 'On Leave', 'Inactive'].includes(status)) {
      query.status = status;
    }

    const currentMonth = getCurrentMonthStr();

    const [staffList, staffAgg, paymentsThisMonth] = await Promise.all([
      Staff.find(query).sort({ status: 1, name: 1 }),
      Staff.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            totalStaff: { $sum: 1 },
            activeStaff: {
              $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] },
            },
            monthlyPayrollCommitment: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'Active'] },
                  {
                    $cond: [
                      { $eq: ['$salaryFrequency', 'Monthly'] },
                      '$salary',
                      {
                        $cond: [
                          { $eq: ['$salaryFrequency', 'Weekly'] },
                          { $multiply: ['$salary', 4] },
                          { $multiply: ['$salary', 30] },
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
            },
          },
        },
      ]),
      StaffPayment.aggregate([
        { $match: { userId, forMonth: currentMonth, paymentStatus: 'Paid' } },
        { $group: { _id: null, totalPaid: { $sum: '$amount' } } },
      ]),
    ]);

    const summary = {
      totalStaff: staffAgg[0]?.totalStaff || 0,
      activeStaff: staffAgg[0]?.activeStaff || 0,
      monthlyPayroll: staffAgg[0]?.monthlyPayrollCommitment || 0,
      disbursedThisMonth: paymentsThisMonth[0]?.totalPaid || 0,
      currentMonth,
    };

    res.render('staff/index', {
      title: 'Staff Roster & Payroll',
      activeMenu: 'staff',
      staffList,
      summary,
      currency,
      filters: {
        search: search || '',
        status: status || '',
      },
    });
  } catch (error) {
    console.error('[Get Staff List Error]', error);
    req.flash('error_msg', 'Failed to retrieve staff directory.');
    res.redirect('/dashboard');
  }
};

// 2. Render Create Staff Form
const getNewStaff = async (req, res) => {
  try {
    const userId = req.session.userId;
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    res.render('staff/form', {
      title: 'Add New Employee',
      activeMenu: 'staff',
      isEdit: false,
      staff: {},
      currency,
      today: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error('[Get New Staff Error]', error);
    req.flash('error_msg', 'Unable to load employee registration form.');
    res.redirect('/staff');
  }
};

// 3. Process and Save New Staff Member
const postNewStaff = async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      name,
      phone,
      position,
      joiningDate,
      salary,
      salaryFrequency,
      paymentDay,
      status,
      notes,
    } = req.body;

    if (!name || !name.trim()) {
      req.flash('error_msg', 'Staff name is required.');
      return res.redirect('/staff/new');
    }

    if (!phone || !phone.trim()) {
      req.flash('error_msg', 'Phone number is required.');
      return res.redirect('/staff/new');
    }

    if (!position || !position.trim()) {
      req.flash('error_msg', 'Job position is required.');
      return res.redirect('/staff/new');
    }

    const parsedSalary = parseFloat(salary);
    if (isNaN(parsedSalary) || parsedSalary < 0) {
      req.flash('error_msg', 'Valid salary amount is required.');
      return res.redirect('/staff/new');
    }

    const newStaff = new Staff({
      userId,
      name: name.trim(),
      phone: phone.trim(),
      position: position.trim(),
      joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
      salary: parsedSalary,
      salaryFrequency: ['Monthly', 'Weekly', 'Daily'].includes(salaryFrequency) ? salaryFrequency : 'Monthly',
      paymentDay: Math.min(31, Math.max(1, parseInt(paymentDay) || 1)),
      status: ['Active', 'On Leave', 'Inactive'].includes(status) ? status : 'Active',
      notes: notes ? notes.trim() : '',
    });

    await newStaff.save();
    req.flash('success_msg', `Employee "${newStaff.name}" registered successfully.`);
    res.redirect(`/staff/${newStaff._id}`);
  } catch (error) {
    console.error('[Post New Staff Error]', error);
    req.flash('error_msg', 'Failed to register staff: ' + error.message);
    res.redirect('/staff/new');
  }
};

// 4. View Staff Profile & Payroll Disbursement History
const getStaffDetail = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid staff ID.');
      return res.redirect('/staff');
    }

    const [staff, payments, settings] = await Promise.all([
      Staff.findOne({ _id: id, userId }),
      StaffPayment.find({ staff: id, userId }).sort({ paymentDate: -1, createdAt: -1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!staff) {
      req.flash('error_msg', 'Staff record not found.');
      return res.redirect('/staff');
    }

    const totalDisbursed = payments
      .filter((p) => p.paymentStatus === 'Paid')
      .reduce((sum, p) => sum + p.amount, 0);

    const currency = settings?.currency || '₹';
    const currentMonth = getCurrentMonthStr();

    res.render('staff/detail', {
      title: `${staff.name} - Profile & Payroll`,
      activeMenu: 'staff',
      staff,
      payments,
      totalDisbursed,
      currency,
      currentMonth,
      today: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error('[Get Staff Detail Error]', error);
    req.flash('error_msg', 'Unable to retrieve employee details.');
    res.redirect('/staff');
  }
};

// 5. Render Edit Staff Form
const getEditStaff = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid staff ID.');
      return res.redirect('/staff');
    }

    const [staff, settings] = await Promise.all([
      Staff.findOne({ _id: id, userId }),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!staff) {
      req.flash('error_msg', 'Staff record not found.');
      return res.redirect('/staff');
    }

    const currency = settings?.currency || '₹';

    res.render('staff/form', {
      title: `Edit Employee - ${staff.name}`,
      activeMenu: 'staff',
      isEdit: true,
      staff,
      currency,
      today: new Date(staff.joiningDate).toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error('[Get Edit Staff Error]', error);
    req.flash('error_msg', 'Unable to load edit employee form.');
    res.redirect('/staff');
  }
};

// 6. Process Update Staff Member
const putStaff = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid staff ID.');
      return res.redirect('/staff');
    }

    const staff = await Staff.findOne({ _id: id, userId });
    if (!staff) {
      req.flash('error_msg', 'Staff record not found.');
      return res.redirect('/staff');
    }

    const {
      name,
      phone,
      position,
      joiningDate,
      salary,
      salaryFrequency,
      paymentDay,
      status,
      notes,
    } = req.body;

    if (!name || !name.trim()) {
      req.flash('error_msg', 'Staff name is required.');
      return res.redirect(`/staff/${id}/edit`);
    }

    if (!phone || !phone.trim()) {
      req.flash('error_msg', 'Phone number is required.');
      return res.redirect(`/staff/${id}/edit`);
    }

    if (!position || !position.trim()) {
      req.flash('error_msg', 'Job position is required.');
      return res.redirect(`/staff/${id}/edit`);
    }

    const parsedSalary = parseFloat(salary);
    if (isNaN(parsedSalary) || parsedSalary < 0) {
      req.flash('error_msg', 'Valid salary amount is required.');
      return res.redirect(`/staff/${id}/edit`);
    }

    staff.name = name.trim();
    staff.phone = phone.trim();
    staff.position = position.trim();
    if (joiningDate) staff.joiningDate = new Date(joiningDate);
    staff.salary = parsedSalary;
    staff.salaryFrequency = ['Monthly', 'Weekly', 'Daily'].includes(salaryFrequency) ? salaryFrequency : staff.salaryFrequency;
    staff.paymentDay = Math.min(31, Math.max(1, parseInt(paymentDay) || 1));
    staff.status = ['Active', 'On Leave', 'Inactive'].includes(status) ? status : staff.status;
    staff.notes = notes ? notes.trim() : '';

    await staff.save();
    req.flash('success_msg', `Employee "${staff.name}" profile updated successfully.`);
    res.redirect(`/staff/${staff._id}`);
  } catch (error) {
    console.error('[Put Staff Error]', error);
    req.flash('error_msg', 'Failed to update employee: ' + error.message);
    res.redirect(`/staff/${req.params.id}/edit`);
  }
};

// 7. Disburse Salary & Automatically Log Operating Expense
const postDisburseSalary = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;
    const { amount, forMonth, paymentMethod, paymentDate, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid staff ID.');
      return res.redirect('/staff');
    }

    const staff = await Staff.findOne({ _id: id, userId });
    if (!staff) {
      req.flash('error_msg', 'Staff member not found.');
      return res.redirect('/staff');
    }

    const payAmount = parseFloat(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      req.flash('error_msg', 'Please enter a valid positive salary amount.');
      return res.redirect(`/staff/${id}`);
    }

    if (!forMonth || !forMonth.trim()) {
      req.flash('error_msg', 'Salary period month (YYYY-MM) is required.');
      return res.redirect(`/staff/${id}`);
    }

    const pDate = paymentDate ? new Date(paymentDate) : new Date();

    // 1. Create StaffPayment Record
    const newPayment = new StaffPayment({
      userId,
      staff: staff._id,
      staffName: staff.name,
      amount: payAmount,
      paymentDate: pDate,
      forMonth: forMonth.trim(),
      paymentMethod: ['Cash', 'UPI', 'Bank Transfer', 'Cheque'].includes(paymentMethod) ? paymentMethod : 'Bank Transfer',
      paymentStatus: 'Paid',
      notes: notes ? notes.trim() : '',
    });

    await newPayment.save();

    // 2. Automatically synchronize with business operating Expense
    const newExpense = new Expense({
      userId,
      title: `Salary: ${staff.name} (${forMonth.trim()})`,
      category: 'Salary',
      amount: payAmount,
      date: pDate,
      paymentStatus: 'Paid',
      recurring: true,
      notes: `Disbursement voucher for ${staff.name} [Voucher Ref: ${newPayment._id}]`,
    });

    await newExpense.save();

    req.flash(
      'success_msg',
      `Salary of ${payAmount.toFixed(2)} disbursed for ${forMonth.trim()} and recorded in operating expenses.`
    );
    res.redirect(`/staff/${staff._id}`);
  } catch (error) {
    console.error('[Disburse Salary Error]', error);
    req.flash('error_msg', 'Failed to disburse salary: ' + error.message);
    res.redirect(`/staff/${req.params.id}`);
  }
};

// 8. Void Salary Payment Voucher & Remove Synced Expense
const deletePaymentVoucher = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { paymentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      req.flash('error_msg', 'Invalid payment voucher ID.');
      return res.redirect('/staff');
    }

    const payment = await StaffPayment.findOne({ _id: paymentId, userId });
    if (!payment) {
      req.flash('error_msg', 'Payment voucher not found.');
      return res.redirect('/staff');
    }

    const staffId = payment.staff;

    // Remove corresponding salary expense entry
    await Expense.deleteMany({
      userId,
      category: 'Salary',
      notes: { $regex: paymentId.toString(), $options: 'i' },
    });

    await StaffPayment.deleteOne({ _id: paymentId, userId });

    req.flash('success_msg', `Salary voucher of ${payment.amount.toFixed(2)} voided and expense reversed.`);
    res.redirect(`/staff/${staffId}`);
  } catch (error) {
    console.error('[Delete Payment Voucher Error]', error);
    req.flash('error_msg', 'Failed to void salary voucher: ' + error.message);
    res.redirect('/staff');
  }
};

// 9. Delete Staff Member with Audit Protection
const deleteStaff = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid staff ID.');
      return res.redirect('/staff');
    }

    const staff = await Staff.findOne({ _id: id, userId });
    if (!staff) {
      req.flash('error_msg', 'Staff record not found.');
      return res.redirect('/staff');
    }

    // Safety: Check if payroll history exists
    const paymentCount = await StaffPayment.countDocuments({ staff: id, userId });
    if (paymentCount > 0) {
      req.flash(
        'error_msg',
        `Cannot delete "${staff.name}" because they have ${paymentCount} salary payment records. Set their status to "Inactive" instead to retain accounting audit trails.`
      );
      return res.redirect(`/staff/${id}`);
    }

    await Staff.deleteOne({ _id: id, userId });
    req.flash('success_msg', `Staff member "${staff.name}" removed successfully.`);
    res.redirect('/staff');
  } catch (error) {
    console.error('[Delete Staff Error]', error);
    req.flash('error_msg', 'Failed to delete staff: ' + error.message);
    res.redirect('/staff');
  }
};

module.exports = {
  getStaffList,
  getNewStaff,
  postNewStaff,
  getStaffDetail,
  getEditStaff,
  putStaff,
  postDisburseSalary,
  deletePaymentVoucher,
  deleteStaff,
};
