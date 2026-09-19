const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const StockMovement = require('../models/StockMovement');
const BusinessSettings = require('../models/BusinessSettings');

// 1. List all purchases with filters & KPI summary
const getPurchases = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    const { supplier, status, search } = req.query;

    const query = { userId };

    if (supplier && mongoose.Types.ObjectId.isValid(supplier)) {
      query.supplier = supplier;
    }

    if (status && ['Paid', 'Partially Paid', 'Pending'].includes(status)) {
      query.paymentStatus = status;
    }

    if (search && search.trim()) {
      query.invoiceNumber = { $regex: search.trim(), $options: 'i' };
    }

    const [purchases, suppliers, kpiAgg] = await Promise.all([
      Purchase.find(query)
        .populate('supplier', 'name company phone')
        .populate('items.product', 'name sku unit')
        .sort({ purchaseDate: -1, createdAt: -1 }),
      Supplier.find({ userId }).sort({ name: 1 }).select('_id name company'),
      Purchase.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            totalInvoices: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' },
            totalPaid: { $sum: '$paidAmount' },
            totalDue: { $sum: '$remainingAmount' },
          },
        },
      ]),
    ]);

    const summary = {
      totalInvoices: kpiAgg[0]?.totalInvoices || 0,
      totalAmount: kpiAgg[0]?.totalAmount || 0,
      totalPaid: kpiAgg[0]?.totalPaid || 0,
      totalDue: kpiAgg[0]?.totalDue || 0,
    };

    res.render('purchases/index', {
      title: 'Purchase Invoices',
      activeMenu: 'purchases',
      purchases,
      suppliers,
      summary,
      currency,
      filters: {
        supplier: supplier || '',
        status: status || '',
        search: search || '',
      },
    });
  } catch (error) {
    console.error('[Get Purchases Error]', error);
    req.flash('error_msg', 'Failed to load purchase invoices.');
    res.redirect('/dashboard');
  }
};

// 2. Render Create Purchase Form
const getNewPurchase = async (req, res) => {
  try {
    const userId = req.session.userId;
    const preselectedSupplier = req.query.supplierId || '';

    const [suppliers, products, settings] = await Promise.all([
      Supplier.find({ userId }).sort({ name: 1 }),
      Product.find({ userId }).sort({ name: 1 }).select('_id name sku purchasePrice currentStock unit supplier'),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    // Auto-generate invoice suggestion
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const suggestedInvoiceNumber = `INV-PUR-${dateStr}-${randomSuffix}`;

    res.render('purchases/form', {
      title: 'New Purchase Order / Inward Invoice',
      activeMenu: 'purchases',
      suppliers,
      products,
      currency,
      preselectedSupplier,
      suggestedInvoiceNumber,
      today: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error('[Get New Purchase Error]', error);
    req.flash('error_msg', 'Unable to load purchase entry form.');
    res.redirect('/purchases');
  }
};

// 3. Process and Save New Purchase
const postNewPurchase = async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      supplierId,
      invoiceNumber,
      purchaseDate,
      dueDate,
      paidAmount: rawPaidAmount,
      notes,
    } = req.body;

    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
      req.flash('error_msg', 'Please select a valid supplier.');
      return res.redirect('/purchases/new');
    }

    if (!invoiceNumber || !invoiceNumber.trim()) {
      req.flash('error_msg', 'Invoice number is required.');
      return res.redirect('/purchases/new');
    }

    // Check for duplicate invoice number for this user
    const existingInvoice = await Purchase.findOne({
      userId,
      invoiceNumber: invoiceNumber.trim(),
    });
    if (existingInvoice) {
      req.flash('error_msg', `An invoice with number "${invoiceNumber.trim()}" already exists.`);
      return res.redirect('/purchases/new');
    }

    const targetSupplier = await Supplier.findOne({ _id: supplierId, userId });
    if (!targetSupplier) {
      req.flash('error_msg', 'Selected supplier not found.');
      return res.redirect('/purchases/new');
    }

    // Parse items array
    let items = [];
    if (typeof req.body.items === 'string') {
      try {
        items = JSON.parse(req.body.items);
      } catch (err) {
        console.warn('[Purchase Parse Items Warning]', err);
      }
    }

    if (!items || items.length === 0) {
      const productIds = Array.isArray(req.body.productId)
        ? req.body.productId
        : req.body.productId
        ? [req.body.productId]
        : [];
      const quantities = Array.isArray(req.body.quantity)
        ? req.body.quantity
        : req.body.quantity
        ? [req.body.quantity]
        : [];
      const prices = Array.isArray(req.body.purchasePrice)
        ? req.body.purchasePrice
        : req.body.purchasePrice
        ? [req.body.purchasePrice]
        : [];

      for (let i = 0; i < productIds.length; i++) {
        const pId = productIds[i];
        const qty = parseFloat(quantities[i]);
        const cost = parseFloat(prices[i]);

        if (pId && mongoose.Types.ObjectId.isValid(pId) && !isNaN(qty) && qty > 0) {
          items.push({
            product: pId,
            quantity: qty,
            purchasePrice: isNaN(cost) || cost < 0 ? 0 : cost,
            subtotal: qty * (isNaN(cost) || cost < 0 ? 0 : cost),
          });
        }
      }
    }

    if (items.length === 0) {
      req.flash('error_msg', 'Please add at least one valid product item to the purchase.');
      return res.redirect('/purchases/new');
    }

    // Calculate totals
    const totalAmount = items.reduce((acc, it) => acc + (it.subtotal || it.quantity * it.purchasePrice), 0);
    const paidAmount = Math.max(0, Math.min(totalAmount, parseFloat(rawPaidAmount) || 0));
    const remainingAmount = Math.max(0, totalAmount - paidAmount);

    let paymentStatus = 'Pending';
    if (paidAmount >= totalAmount && totalAmount > 0) {
      paymentStatus = 'Paid';
    } else if (paidAmount > 0) {
      paymentStatus = 'Partially Paid';
    }

    // 1. Create Purchase Document
    const newPurchase = new Purchase({
      userId,
      supplier: supplierId,
      invoiceNumber: invoiceNumber.trim(),
      items: items.map((it) => ({
        product: it.product,
        quantity: it.quantity,
        purchasePrice: it.purchasePrice,
        subtotal: it.subtotal || it.quantity * it.purchasePrice,
      })),
      totalAmount,
      paidAmount,
      remainingAmount,
      paymentStatus,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      notes: notes ? notes.trim() : '',
    });

    await newPurchase.save();

    // 2. Update Product Inventory & Log StockMovement
    for (const item of items) {
      const product = await Product.findOne({ _id: item.product, userId });
      if (product) {
        const prevStock = product.currentStock;
        const nextStock = prevStock + item.quantity;

        product.currentStock = nextStock;
        // Optionally update default purchase cost to latest purchase price
        if (item.purchasePrice > 0) {
          product.purchasePrice = item.purchasePrice;
        }
        // Link supplier if unlinked
        if (!product.supplier) {
          product.supplier = supplierId;
        }
        await product.save();

        await StockMovement.create({
          userId,
          product: product._id,
          type: 'PURCHASE',
          quantity: item.quantity,
          previousStock: prevStock,
          newStock: nextStock,
          referenceId: newPurchase._id,
          notes: `Purchased via Invoice #${newPurchase.invoiceNumber}`,
          date: newPurchase.purchaseDate,
        });
      }
    }

    // 3. Update Supplier Financial Aggregates
    targetSupplier.totalPurchases = (targetSupplier.totalPurchases || 0) + totalAmount;
    targetSupplier.amountPaid = (targetSupplier.amountPaid || 0) + paidAmount;
    targetSupplier.amountDue = (targetSupplier.amountDue || 0) + remainingAmount;
    await targetSupplier.save();

    req.flash('success_msg', `Purchase invoice "${newPurchase.invoiceNumber}" saved successfully. Stock levels updated.`);
    res.redirect(`/purchases/${newPurchase._id}`);
  } catch (error) {
    console.error('[Post New Purchase Error]', error);
    req.flash('error_msg', 'Failed to create purchase: ' + error.message);
    res.redirect('/purchases/new');
  }
};

// 4. View Purchase Invoice Detail
const getPurchaseDetail = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid purchase invoice ID.');
      return res.redirect('/purchases');
    }

    const [purchase, settings] = await Promise.all([
      Purchase.findOne({ _id: id, userId })
        .populate('supplier')
        .populate('items.product', 'name sku unit brand purchasePrice sellingPrice currentStock'),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!purchase) {
      req.flash('error_msg', 'Purchase invoice not found.');
      return res.redirect('/purchases');
    }

    const currency = settings?.currency || '₹';

    res.render('purchases/detail', {
      title: `Invoice ${purchase.invoiceNumber}`,
      activeMenu: 'purchases',
      purchase,
      currency,
      settings,
    });
  } catch (error) {
    console.error('[Get Purchase Detail Error]', error);
    req.flash('error_msg', 'Unable to retrieve purchase invoice.');
    res.redirect('/purchases');
  }
};

// 5. Record Additional Payment towards an Invoice
const postRecordPayment = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;
    const paymentAmount = parseFloat(req.body.paymentAmount);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid purchase ID.');
      return res.redirect('/purchases');
    }

    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      req.flash('error_msg', 'Please enter a valid positive payment amount.');
      return res.redirect(`/purchases/${id}`);
    }

    const purchase = await Purchase.findOne({ _id: id, userId });
    if (!purchase) {
      req.flash('error_msg', 'Purchase invoice not found.');
      return res.redirect('/purchases');
    }

    if (purchase.remainingAmount <= 0) {
      req.flash('error_msg', 'This invoice is already fully paid.');
      return res.redirect(`/purchases/${id}`);
    }

    // Cap payment to remaining balance
    const actualPay = Math.min(paymentAmount, purchase.remainingAmount);

    purchase.paidAmount += actualPay;
    purchase.remainingAmount = Math.max(0, purchase.remainingAmount - actualPay);

    if (purchase.remainingAmount <= 0) {
      purchase.paymentStatus = 'Paid';
    } else {
      purchase.paymentStatus = 'Partially Paid';
    }

    await purchase.save();

    // Update Supplier
    const supplier = await Supplier.findOne({ _id: purchase.supplier, userId });
    if (supplier) {
      supplier.amountPaid = (supplier.amountPaid || 0) + actualPay;
      supplier.amountDue = Math.max(0, (supplier.amountDue || 0) - actualPay);
      await supplier.save();
    }

    req.flash('success_msg', `Payment of ${actualPay.toFixed(2)} recorded successfully.`);
    res.redirect(`/purchases/${id}`);
  } catch (error) {
    console.error('[Record Purchase Payment Error]', error);
    req.flash('error_msg', 'Failed to record payment: ' + error.message);
    res.redirect(`/purchases/${req.params.id}`);
  }
};

// 6. Void / Delete a Purchase Invoice
const deletePurchase = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid purchase ID.');
      return res.redirect('/purchases');
    }

    const purchase = await Purchase.findOne({ _id: id, userId });
    if (!purchase) {
      req.flash('error_msg', 'Purchase invoice not found.');
      return res.redirect('/purchases');
    }

    // 1. Rollback stock increments
    for (const item of purchase.items) {
      const product = await Product.findOne({ _id: item.product, userId });
      if (product) {
        const prevStock = product.currentStock;
        const nextStock = Math.max(0, prevStock - item.quantity);

        product.currentStock = nextStock;
        await product.save();

        await StockMovement.create({
          userId,
          product: product._id,
          type: 'ADJUSTMENT',
          quantity: -item.quantity,
          previousStock: prevStock,
          newStock: nextStock,
          referenceId: purchase._id,
          notes: `Reverted purchase void: Invoice #${purchase.invoiceNumber}`,
          date: new Date(),
        });
      }
    }

    // 2. Rollback Supplier Financial Balances
    const supplier = await Supplier.findOne({ _id: purchase.supplier, userId });
    if (supplier) {
      supplier.totalPurchases = Math.max(0, (supplier.totalPurchases || 0) - purchase.totalAmount);
      supplier.amountPaid = Math.max(0, (supplier.amountPaid || 0) - purchase.paidAmount);
      supplier.amountDue = Math.max(0, (supplier.amountDue || 0) - purchase.remainingAmount);
      await supplier.save();
    }

    // 3. Delete StockMovements directly attached to this purchase
    await StockMovement.deleteMany({ referenceId: purchase._id, type: 'PURCHASE' });

    // 4. Delete Purchase document
    await Purchase.deleteOne({ _id: id, userId });

    req.flash('success_msg', `Purchase invoice #${purchase.invoiceNumber} has been voided and inventory reversed.`);
    res.redirect('/purchases');
  } catch (error) {
    console.error('[Delete Purchase Error]', error);
    req.flash('error_msg', 'Failed to void purchase invoice: ' + error.message);
    res.redirect('/purchases');
  }
};

module.exports = {
  getPurchases,
  getNewPurchase,
  postNewPurchase,
  getPurchaseDetail,
  postRecordPayment,
  deletePurchase,
};
