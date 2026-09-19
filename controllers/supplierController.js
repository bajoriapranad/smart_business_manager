const mongoose = require('mongoose');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const Purchase = require('../models/Purchase');
const BusinessSettings = require('../models/BusinessSettings');

// 1. List Suppliers with Search & Summary
const getSuppliers = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    const search = (req.query.search || '').trim();

    const query = { userId };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const suppliers = await Supplier.find(query).sort({ name: 1 });

    // Summary of all supplier accounts
    const summaryAgg = await Supplier.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalSuppliers: { $sum: 1 },
          totalPurchases: { $sum: '$totalPurchases' },
          totalPaid: { $sum: '$amountPaid' },
          totalDue: { $sum: '$amountDue' },
        },
      },
    ]);

    const summary = {
      totalSuppliers: summaryAgg[0]?.totalSuppliers || 0,
      totalPurchases: summaryAgg[0]?.totalPurchases || 0,
      totalPaid: summaryAgg[0]?.totalPaid || 0,
      totalDue: summaryAgg[0]?.totalDue || 0,
    };

    res.render('suppliers/index', {
      title: 'Suppliers Directory',
      activeMenu: 'suppliers',
      suppliers,
      summary,
      currency,
      search,
    });
  } catch (error) {
    console.error('[Get Suppliers Error]', error);
    req.flash('error_msg', 'Failed to load suppliers.');
    res.redirect('/dashboard');
  }
};

// 2. Show Add Supplier Form
const getNewSupplier = (req, res) => {
  res.render('suppliers/form', {
    title: 'Add New Supplier',
    activeMenu: 'suppliers',
    isEdit: false,
    supplier: {},
  });
};

// 3. Handle Add Supplier Submission
const postNewSupplier = async (req, res) => {
  const userId = req.session.userId;
  const { name, company, phone, email, address, gstNumber, paymentTerms, notes } = req.body;

  try {
    if (!name || !name.trim() || !phone || !phone.trim()) {
      req.flash('error_msg', 'Supplier name and phone number are required.');
      return res.redirect('/suppliers/new');
    }

    const newSupplier = new Supplier({
      userId,
      name: name.trim(),
      company: company?.trim() || '',
      phone: phone.trim(),
      email: email?.trim() || '',
      address: address?.trim() || '',
      gstNumber: gstNumber?.trim() || '',
      paymentTerms: paymentTerms?.trim() || 'Net 30',
      notes: notes?.trim() || '',
      totalPurchases: 0,
      amountPaid: 0,
      amountDue: 0,
    });

    await newSupplier.save();
    req.flash('success_msg', `Supplier "${newSupplier.name}" added successfully.`);
    res.redirect('/suppliers');
  } catch (error) {
    console.error('[Create Supplier Error]', error);
    req.flash('error_msg', 'Failed to create supplier: ' + error.message);
    res.redirect('/suppliers/new');
  }
};

// 4. Show Supplier Detail View (Ledger, Balance, Products, Invoices)
const getSupplierDetail = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid supplier ID.');
      return res.redirect('/suppliers');
    }

    const [supplier, products, purchases, settings] = await Promise.all([
      Supplier.findOne({ _id: id, userId }),
      Product.find({ supplier: id, userId }).sort({ name: 1 }),
      Purchase.find({ supplier: id, userId }).sort({ purchaseDate: -1 }),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!supplier) {
      req.flash('error_msg', 'Supplier not found.');
      return res.redirect('/suppliers');
    }

    const currency = settings?.currency || '₹';

    res.render('suppliers/detail', {
      title: `${supplier.name} - Statement`,
      activeMenu: 'suppliers',
      supplier,
      products,
      purchases,
      currency,
    });
  } catch (error) {
    console.error('[Get Supplier Detail Error]', error);
    req.flash('error_msg', 'Failed to retrieve supplier details.');
    res.redirect('/suppliers');
  }
};

// 5. Show Edit Supplier Form
const getEditSupplier = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid supplier ID.');
      return res.redirect('/suppliers');
    }

    const supplier = await Supplier.findOne({ _id: id, userId });
    if (!supplier) {
      req.flash('error_msg', 'Supplier not found.');
      return res.redirect('/suppliers');
    }

    res.render('suppliers/form', {
      title: `Edit ${supplier.name}`,
      activeMenu: 'suppliers',
      isEdit: true,
      supplier,
    });
  } catch (error) {
    console.error('[Get Edit Supplier Error]', error);
    req.flash('error_msg', 'Failed to load supplier.');
    res.redirect('/suppliers');
  }
};

// 6. Handle Edit Supplier Submission
const putSupplier = async (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { name, company, phone, email, address, gstNumber, paymentTerms, notes } = req.body;

  try {
    const supplier = await Supplier.findOne({ _id: id, userId });
    if (!supplier) {
      req.flash('error_msg', 'Supplier not found.');
      return res.redirect('/suppliers');
    }

    if (!name || !name.trim() || !phone || !phone.trim()) {
      req.flash('error_msg', 'Supplier name and phone number are required.');
      return res.redirect(`/suppliers/${id}/edit`);
    }

    supplier.name = name.trim();
    supplier.company = company?.trim() || '';
    supplier.phone = phone.trim();
    supplier.email = email?.trim() || '';
    supplier.address = address?.trim() || '';
    supplier.gstNumber = gstNumber?.trim() || '';
    supplier.paymentTerms = paymentTerms?.trim() || 'Net 30';
    supplier.notes = notes?.trim() || '';

    await supplier.save();
    req.flash('success_msg', `Supplier "${supplier.name}" updated successfully.`);
    res.redirect(`/suppliers/${supplier._id}`);
  } catch (error) {
    console.error('[Update Supplier Error]', error);
    req.flash('error_msg', 'Failed to update supplier.');
    res.redirect(`/suppliers/${id}/edit`);
  }
};

// 7. Handle Delete Supplier
const deleteSupplier = async (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;

  try {
    // Check if supplier has purchases
    const purchaseCount = await Purchase.countDocuments({ supplier: id, userId });
    if (purchaseCount > 0) {
      req.flash(
        'error_msg',
        `Cannot delete supplier. ${purchaseCount} purchase record(s) exist for this supplier.`
      );
      return res.redirect('/suppliers');
    }

    // Unset supplier reference on products
    await Product.updateMany({ supplier: id, userId }, { $unset: { supplier: 1 } });

    await Supplier.findOneAndDelete({ _id: id, userId });
    req.flash('success_msg', 'Supplier deleted successfully.');
    res.redirect('/suppliers');
  } catch (error) {
    console.error('[Delete Supplier Error]', error);
    req.flash('error_msg', 'Failed to delete supplier.');
    res.redirect('/suppliers');
  }
};

module.exports = {
  getSuppliers,
  getNewSupplier,
  postNewSupplier,
  getSupplierDetail,
  getEditSupplier,
  putSupplier,
  deleteSupplier,
};
