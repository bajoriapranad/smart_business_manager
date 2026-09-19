const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Sale = require('../models/Sale');
const BusinessSettings = require('../models/BusinessSettings');

// 1. List Customers with Search, Filters, and Financial KPI Aggregates
const getCustomers = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    const { search, loyalty, balance } = req.query;

    const query = { userId };

    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { address: searchRegex },
      ];
    }

    if (loyalty && ['Standard', 'Regular', 'Frequent', 'VIP'].includes(loyalty)) {
      query.loyaltyLevel = loyalty;
    }

    if (balance === 'due') {
      query.outstandingBalance = { $gt: 0 };
    } else if (balance === 'clear') {
      query.outstandingBalance = { $lte: 0 };
    }

    const [customers, kpiAgg] = await Promise.all([
      Customer.find(query).sort({ totalSpent: -1, createdAt: -1 }),
      Customer.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            totalCustomers: { $sum: 1 },
            totalSpent: { $sum: '$totalSpent' },
            totalDue: { $sum: '$outstandingBalance' },
            vipCount: {
              $sum: {
                $cond: [{ $in: ['$loyaltyLevel', ['VIP', 'Frequent']] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const summary = {
      totalCustomers: kpiAgg[0]?.totalCustomers || 0,
      totalSpent: kpiAgg[0]?.totalSpent || 0,
      totalDue: kpiAgg[0]?.totalDue || 0,
      vipCount: kpiAgg[0]?.vipCount || 0,
    };

    res.render('customers/index', {
      title: 'Customer Directory',
      activeMenu: 'customers',
      customers,
      summary,
      currency,
      filters: {
        search: search || '',
        loyalty: loyalty || '',
        balance: balance || '',
      },
    });
  } catch (error) {
    console.error('[Get Customers Error]', error);
    req.flash('error_msg', 'Failed to retrieve customer accounts.');
    res.redirect('/dashboard');
  }
};

// 2. Render Create Customer Form
const getNewCustomer = async (req, res) => {
  try {
    const userId = req.session.userId;
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    res.render('customers/form', {
      title: 'Add New Customer',
      activeMenu: 'customers',
      isEdit: false,
      customer: {},
      loyaltyTiers: settings?.loyaltyTiers || [],
      currency,
    });
  } catch (error) {
    console.error('[Get New Customer Error]', error);
    req.flash('error_msg', 'Unable to load customer creation form.');
    res.redirect('/customers');
  }
};

// 3. Process and Save New Customer
const postNewCustomer = async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      name,
      phone,
      email,
      address,
      loyaltyLevel,
      discountPercentage,
      openingBalance,
      notes,
    } = req.body;

    if (!name || !name.trim()) {
      req.flash('error_msg', 'Customer name is required.');
      return res.redirect('/customers/new');
    }

    if (!phone || !phone.trim()) {
      req.flash('error_msg', 'Customer phone number is required.');
      return res.redirect('/customers/new');
    }

    const trimmedPhone = phone.trim();

    // Check unique phone per user
    const existing = await Customer.findOne({ userId, phone: trimmedPhone });
    if (existing) {
      req.flash('error_msg', `A customer with phone "${trimmedPhone}" already exists.`);
      return res.redirect('/customers/new');
    }

    const parsedDiscount = parseFloat(discountPercentage);
    const parsedBalance = parseFloat(openingBalance);

    const newCustomer = new Customer({
      userId,
      name: name.trim(),
      phone: trimmedPhone,
      email: email ? email.trim() : '',
      address: address ? address.trim() : '',
      loyaltyLevel: loyaltyLevel || 'Standard',
      discountPercentage: isNaN(parsedDiscount) ? 0 : Math.max(0, Math.min(100, parsedDiscount)),
      outstandingBalance: isNaN(parsedBalance) ? 0 : Math.max(0, parsedBalance),
      totalSpent: 0,
      notes: notes ? notes.trim() : '',
    });

    await newCustomer.save();
    req.flash('success_msg', `Customer "${newCustomer.name}" added successfully.`);
    res.redirect(`/customers/${newCustomer._id}`);
  } catch (error) {
    console.error('[Post New Customer Error]', error);
    req.flash('error_msg', 'Failed to create customer: ' + error.message);
    res.redirect('/customers/new');
  }
};

// 4. View Customer Profile, Credit Statement & Purchase Ledger
const getCustomerDetail = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid customer ID.');
      return res.redirect('/customers');
    }

    const [customer, sales, settings] = await Promise.all([
      Customer.findOne({ _id: id, userId }),
      Sale.find({ customer: id, userId }).sort({ saleDate: -1, createdAt: -1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!customer) {
      req.flash('error_msg', 'Customer profile not found.');
      return res.redirect('/customers');
    }

    const currency = settings?.currency || '₹';

    res.render('customers/detail', {
      title: `${customer.name} - Profile & Ledger`,
      activeMenu: 'customers',
      customer,
      sales,
      currency,
    });
  } catch (error) {
    console.error('[Get Customer Detail Error]', error);
    req.flash('error_msg', 'Unable to retrieve customer details.');
    res.redirect('/customers');
  }
};

// 5. Render Edit Customer Form
const getEditCustomer = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid customer ID.');
      return res.redirect('/customers');
    }

    const [customer, settings] = await Promise.all([
      Customer.findOne({ _id: id, userId }),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!customer) {
      req.flash('error_msg', 'Customer not found.');
      return res.redirect('/customers');
    }

    const currency = settings?.currency || '₹';

    res.render('customers/form', {
      title: `Edit Customer - ${customer.name}`,
      activeMenu: 'customers',
      isEdit: true,
      customer,
      loyaltyTiers: settings?.loyaltyTiers || [],
      currency,
    });
  } catch (error) {
    console.error('[Get Edit Customer Error]', error);
    req.flash('error_msg', 'Unable to load edit customer form.');
    res.redirect('/customers');
  }
};

// 6. Process Update Customer Details
const putCustomer = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid customer ID.');
      return res.redirect('/customers');
    }

    const customer = await Customer.findOne({ _id: id, userId });
    if (!customer) {
      req.flash('error_msg', 'Customer not found.');
      return res.redirect('/customers');
    }

    const {
      name,
      phone,
      email,
      address,
      loyaltyLevel,
      discountPercentage,
      notes,
    } = req.body;

    if (!name || !name.trim()) {
      req.flash('error_msg', 'Customer name is required.');
      return res.redirect(`/customers/${id}/edit`);
    }

    if (!phone || !phone.trim()) {
      req.flash('error_msg', 'Phone number is required.');
      return res.redirect(`/customers/${id}/edit`);
    }

    const trimmedPhone = phone.trim();

    // Ensure phone is unique to this customer
    if (trimmedPhone !== customer.phone) {
      const duplicate = await Customer.findOne({ userId, phone: trimmedPhone, _id: { $ne: id } });
      if (duplicate) {
        req.flash('error_msg', `Phone number "${trimmedPhone}" is already assigned to ${duplicate.name}.`);
        return res.redirect(`/customers/${id}/edit`);
      }
    }

    const parsedDiscount = parseFloat(discountPercentage);

    customer.name = name.trim();
    customer.phone = trimmedPhone;
    customer.email = email ? email.trim() : '';
    customer.address = address ? address.trim() : '';
    customer.loyaltyLevel = loyaltyLevel || customer.loyaltyLevel;
    customer.discountPercentage = isNaN(parsedDiscount) ? 0 : Math.max(0, Math.min(100, parsedDiscount));
    customer.notes = notes ? notes.trim() : '';

    await customer.save();
    req.flash('success_msg', `Customer "${customer.name}" updated successfully.`);
    res.redirect(`/customers/${customer._id}`);
  } catch (error) {
    console.error('[Put Customer Error]', error);
    req.flash('error_msg', 'Failed to update customer: ' + error.message);
    res.redirect(`/customers/${req.params.id}/edit`);
  }
};

// 7. Settle Customer Credit Dues / Record Receivable Payment
const postRecordCustomerPayment = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;
    const paymentAmount = parseFloat(req.body.paymentAmount);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid customer ID.');
      return res.redirect('/customers');
    }

    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      req.flash('error_msg', 'Please enter a valid positive payment amount.');
      return res.redirect(`/customers/${id}`);
    }

    const customer = await Customer.findOne({ _id: id, userId });
    if (!customer) {
      req.flash('error_msg', 'Customer profile not found.');
      return res.redirect('/customers');
    }

    if (customer.outstandingBalance <= 0) {
      req.flash('error_msg', 'This customer has no outstanding credit balance.');
      return res.redirect(`/customers/${id}`);
    }

    const actualPay = Math.min(paymentAmount, customer.outstandingBalance);
    customer.outstandingBalance = Math.max(0, customer.outstandingBalance - actualPay);

    await customer.save();

    req.flash('success_msg', `Received payment of ${actualPay.toFixed(2)}. Updated balance: ${customer.outstandingBalance.toFixed(2)}.`);
    res.redirect(`/customers/${id}`);
  } catch (error) {
    console.error('[Record Customer Payment Error]', error);
    req.flash('error_msg', 'Failed to record customer payment: ' + error.message);
    res.redirect(`/customers/${req.params.id}`);
  }
};

// 8. Delete Customer with Protection Safeguards
const deleteCustomer = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid customer ID.');
      return res.redirect('/customers');
    }

    const customer = await Customer.findOne({ _id: id, userId });
    if (!customer) {
      req.flash('error_msg', 'Customer not found.');
      return res.redirect('/customers');
    }

    // Safety 1: Block deletion if outstanding balance exists
    if (customer.outstandingBalance > 0) {
      req.flash(
        'error_msg',
        `Cannot delete "${customer.name}". This account has an outstanding balance of ${customer.outstandingBalance.toFixed(2)}. Please settle dues first.`
      );
      return res.redirect(`/customers/${id}`);
    }

    // Safety 2: Block deletion if customer has linked sales history
    const linkedSalesCount = await Sale.countDocuments({ customer: id, userId });
    if (linkedSalesCount > 0) {
      req.flash(
        'error_msg',
        `Cannot delete "${customer.name}". This customer is linked to ${linkedSalesCount} sales invoice records. Maintain customer record for financial audit compliance.`
      );
      return res.redirect(`/customers/${id}`);
    }

    await Customer.deleteOne({ _id: id, userId });
    req.flash('success_msg', `Customer "${customer.name}" deleted successfully.`);
    res.redirect('/customers');
  } catch (error) {
    console.error('[Delete Customer Error]', error);
    req.flash('error_msg', 'Failed to delete customer: ' + error.message);
    res.redirect('/customers');
  }
};

module.exports = {
  getCustomers,
  getNewCustomer,
  postNewCustomer,
  getCustomerDetail,
  getEditCustomer,
  putCustomer,
  postRecordCustomerPayment,
  deleteCustomer,
};
