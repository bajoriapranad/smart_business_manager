const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Category = require('../models/Category');
const StockMovement = require('../models/StockMovement');
const BusinessSettings = require('../models/BusinessSettings');

// 1. List Sales Invoices with Filters & KPI Summary
const getSales = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    const { dateRange, paymentMethod, paymentStatus, search } = req.query;

    const query = { userId };

    // Date range filtering
    const now = new Date();
    if (dateRange === 'today') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      query.saleDate = { $gte: startOfDay };
    } else if (dateRange === 'week') {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      query.saleDate = { $gte: startOfWeek };
    } else if (dateRange === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      query.saleDate = { $gte: startOfMonth };
    }

    if (paymentMethod && ['Cash', 'UPI', 'Card', 'Credit', 'Other'].includes(paymentMethod)) {
      query.paymentMethod = paymentMethod;
    }

    if (paymentStatus && ['Paid', 'Partially Paid', 'Pending'].includes(paymentStatus)) {
      query.paymentStatus = paymentStatus;
    }

    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { invoiceNumber: searchRegex },
        { customerName: searchRegex },
        { customerPhone: searchRegex },
      ];
    }

    const [sales, kpiAgg] = await Promise.all([
      Sale.find(query)
        .populate('customer', 'name phone loyaltyLevel')
        .sort({ saleDate: -1, createdAt: -1 }),
      Sale.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            totalSales: { $sum: '$finalAmount' },
            totalCOGS: { $sum: '$costOfGoodsSold' },
            totalProfit: { $sum: '$grossProfit' },
            totalCreditDue: { $sum: '$dueAmount' },
            totalCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const totalSalesVal = kpiAgg[0]?.totalSales || 0;
    const totalProfitVal = kpiAgg[0]?.totalProfit || 0;
    const marginPercent = totalSalesVal > 0 ? ((totalProfitVal / totalSalesVal) * 100).toFixed(1) : '0.0';

    const summary = {
      totalSales: totalSalesVal,
      totalProfit: totalProfitVal,
      marginPercent,
      totalCreditDue: kpiAgg[0]?.totalCreditDue || 0,
      totalCount: kpiAgg[0]?.totalCount || 0,
    };

    res.render('sales/index', {
      title: 'Sales & Invoicing',
      activeMenu: 'sales',
      sales,
      summary,
      currency,
      filters: {
        dateRange: dateRange || '',
        paymentMethod: paymentMethod || '',
        paymentStatus: paymentStatus || '',
        search: search || '',
      },
    });
  } catch (error) {
    console.error('[Get Sales Error]', error);
    req.flash('error_msg', 'Failed to retrieve sales invoices.');
    res.redirect('/dashboard');
  }
};

// 2. Render Point of Sale (POS) Billing Terminal
const getPOS = async (req, res) => {
  try {
    const userId = req.session.userId;

    const [products, categories, customers, settings] = await Promise.all([
      Product.find({ userId })
        .populate('category', 'name')
        .sort({ currentStock: -1, name: 1 })
        .select('_id name sku barcode sellingPrice purchasePrice currentStock minimumStock unit category brand'),
      Category.find({ userId }).sort({ name: 1 }),
      Customer.find({ userId }).sort({ name: 1 }).select('_id name phone loyaltyLevel discountPercentage outstandingBalance'),
      BusinessSettings.findOne({ userId }),
    ]);

    const currency = settings?.currency || '₹';

    // Auto-generate invoice suggestion
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const suggestedInvoiceNumber = `INV-${datePart}-${randSuffix}`;

    res.render('sales/pos', {
      title: 'POS Terminal & Fast Checkout',
      activeMenu: 'sales',
      products,
      categories,
      customers,
      settings: settings || {},
      currency,
      suggestedInvoiceNumber,
    });
  } catch (error) {
    console.error('[Get POS Error]', error);
    req.flash('error_msg', 'Unable to launch POS terminal.');
    res.redirect('/sales');
  }
};

// 3. Process Checkout & Save Sale
const postCheckout = async (req, res) => {
  try {
    const userId = req.session.userId;
    const isAjax = req.xhr || req.headers.accept?.includes('json') || req.is('json');

    const {
      invoiceNumber,
      customerId,
      customerName: customCustName,
      customerPhone: customCustPhone,
      paymentMethod,
      paidAmount: rawPaidAmount,
      discountPercentage: rawDiscountPercent,
      dueDate,
      notes,
    } = req.body;

    if (!invoiceNumber || !invoiceNumber.trim()) {
      const errMsg = 'Invoice number is required.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error_msg', errMsg);
      return res.redirect('/sales/pos');
    }

    // Check duplicate invoice number for this user
    const existing = await Sale.findOne({ userId, invoiceNumber: invoiceNumber.trim() });
    if (existing) {
      const errMsg = `Invoice number "${invoiceNumber.trim()}" already exists.`;
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error_msg', errMsg);
      return res.redirect('/sales/pos');
    }

    // Parse items array
    let items = [];
    if (typeof req.body.items === 'string') {
      try {
        items = JSON.parse(req.body.items);
      } catch (err) {
        console.warn('[Parse Sale Items Warning]', err);
      }
    } else if (Array.isArray(req.body.items)) {
      items = req.body.items;
    }

    // Fallback: standard form arrays
    if (!items || items.length === 0) {
      const productIds = Array.isArray(req.body.productId) ? req.body.productId : (req.body.productId ? [req.body.productId] : []);
      const quantities = Array.isArray(req.body.quantity) ? req.body.quantity : (req.body.quantity ? [req.body.quantity] : []);
      const unitPrices = Array.isArray(req.body.unitPrice) ? req.body.unitPrice : (req.body.unitPrice ? [req.body.unitPrice] : []);

      for (let i = 0; i < productIds.length; i++) {
        const pId = productIds[i];
        const qty = parseFloat(quantities[i]);
        const price = parseFloat(unitPrices[i]);

        if (pId && mongoose.Types.ObjectId.isValid(pId) && !isNaN(qty) && qty > 0) {
          items.push({
            product: pId,
            quantity: qty,
            unitPrice: isNaN(price) || price < 0 ? 0 : price,
          });
        }
      }
    }

    if (!items || items.length === 0) {
      const errMsg = 'Checkout cart cannot be empty. Please add items.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error_msg', errMsg);
      return res.redirect('/sales/pos');
    }

    // Customer lookup
    let linkedCustomer = null;
    let finalCustomerName = (customCustName && customCustName.trim()) || 'Walk-in Customer';
    let finalCustomerPhone = (customCustPhone && customCustPhone.trim()) || '';

    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      linkedCustomer = await Customer.findOne({ _id: customerId, userId });
      if (linkedCustomer) {
        finalCustomerName = linkedCustomer.name;
        finalCustomerPhone = linkedCustomer.phone;
      }
    }

    // Stock verification & line item preparation
    const processedItems = [];
    let subtotalAmount = 0;
    let costOfGoodsSold = 0;

    for (const item of items) {
      const product = await Product.findOne({ _id: item.product, userId });
      if (!product) {
        const errMsg = `Product ID "${item.product}" was not found.`;
        if (isAjax) return res.status(400).json({ success: false, message: errMsg });
        req.flash('error_msg', errMsg);
        return res.redirect('/sales/pos');
      }

      const qty = parseFloat(item.quantity) || 1;
      if (product.currentStock < qty) {
        const errMsg = `Insufficient stock for "${product.name}". Available: ${product.currentStock} ${product.unit}, Requested: ${qty} ${product.unit}.`;
        if (isAjax) return res.status(400).json({ success: false, message: errMsg });
        req.flash('error_msg', errMsg);
        return res.redirect('/sales/pos');
      }

      const unitPrice = item.unitPrice !== undefined ? parseFloat(item.unitPrice) : product.sellingPrice;
      const purchasePrice = product.purchasePrice || 0;
      const lineSubtotal = qty * unitPrice;

      subtotalAmount += lineSubtotal;
      costOfGoodsSold += qty * purchasePrice;

      processedItems.push({
        product: product._id,
        name: product.name,
        quantity: qty,
        unitPrice,
        purchasePrice,
        subtotal: lineSubtotal,
      });
    }

    // Discount calculation
    let discountPercentage = parseFloat(rawDiscountPercent);
    if (isNaN(discountPercentage) || discountPercentage < 0) {
      discountPercentage = linkedCustomer ? linkedCustomer.discountPercentage || 0 : 0;
    }
    discountPercentage = Math.min(100, Math.max(0, discountPercentage));
    const discountAmount = (subtotalAmount * discountPercentage) / 100;
    const finalAmount = Math.max(0, subtotalAmount - discountAmount);

    const grossProfit = finalAmount - costOfGoodsSold;

    // Payment details
    const method = ['Cash', 'UPI', 'Card', 'Credit', 'Other'].includes(paymentMethod) ? paymentMethod : 'Cash';
    let paidAmount = parseFloat(rawPaidAmount);
    if (isNaN(paidAmount) || paidAmount < 0) {
      paidAmount = method === 'Credit' ? 0 : finalAmount;
    }
    paidAmount = Math.min(finalAmount, paidAmount);
    const dueAmount = Math.max(0, finalAmount - paidAmount);

    let paymentStatus = 'Paid';
    if (dueAmount > 0 && paidAmount > 0) {
      paymentStatus = 'Partially Paid';
    } else if (dueAmount > 0) {
      paymentStatus = 'Pending';
    }

    // 1. Create Sale Document
    const newSale = new Sale({
      userId,
      invoiceNumber: invoiceNumber.trim(),
      customer: linkedCustomer ? linkedCustomer._id : undefined,
      customerName: finalCustomerName,
      customerPhone: finalCustomerPhone,
      items: processedItems,
      subtotalAmount,
      discountPercentage,
      discountAmount,
      finalAmount,
      costOfGoodsSold,
      grossProfit,
      paymentMethod: method,
      paymentStatus,
      paidAmount,
      dueAmount,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      saleDate: new Date(),
      notes: notes ? notes.trim() : '',
    });

    await newSale.save();

    // 2. Deduct Inventory Stock & Log StockMovement
    for (const item of processedItems) {
      const product = await Product.findOne({ _id: item.product, userId });
      if (product) {
        const prevStock = product.currentStock;
        const newStock = Math.max(0, prevStock - item.quantity);

        product.currentStock = newStock;
        product.lastSoldDate = new Date();
        await product.save();

        await StockMovement.create({
          userId,
          product: product._id,
          type: 'SALE',
          quantity: -item.quantity,
          previousStock: prevStock,
          newStock,
          referenceId: newSale._id,
          notes: `Sold via Invoice #${newSale.invoiceNumber}`,
          date: newSale.saleDate,
        });
      }
    }

    // 3. Update Customer Stats & Loyalty Tier Progression
    if (linkedCustomer) {
      linkedCustomer.totalSpent = (linkedCustomer.totalSpent || 0) + finalAmount;
      if (dueAmount > 0) {
        linkedCustomer.outstandingBalance = (linkedCustomer.outstandingBalance || 0) + dueAmount;
      }

      // Check for loyalty promotion based on settings
      const settings = await BusinessSettings.findOne({ userId });
      if (settings?.loyaltyTiers && settings.loyaltyTiers.length > 0) {
        // Sort tiers descending by minSpend
        const sortedTiers = [...settings.loyaltyTiers].sort((a, b) => (b.minSpend || 0) - (a.minSpend || 0));
        const qualifiedTier = sortedTiers.find((t) => linkedCustomer.totalSpent >= (t.minSpend || 0));
        if (qualifiedTier && qualifiedTier.name !== linkedCustomer.loyaltyLevel) {
          linkedCustomer.loyaltyLevel = qualifiedTier.name;
          if (qualifiedTier.discountPercent !== undefined) {
            linkedCustomer.discountPercentage = qualifiedTier.discountPercent;
          }
        }
      }

      await linkedCustomer.save();
    }

    if (isAjax) {
      return res.json({
        success: true,
        saleId: newSale._id,
        invoiceNumber: newSale.invoiceNumber,
        finalAmount: newSale.finalAmount,
        redirectUrl: `/sales/${newSale._id}`,
      });
    }

    req.flash('success_msg', `Sale invoice #${newSale.invoiceNumber} completed successfully.`);
    res.redirect(`/sales/${newSale._id}`);
  } catch (error) {
    console.error('[Post Checkout Error]', error);
    const errMsg = 'Failed to complete sale: ' + error.message;
    if (req.xhr || req.headers.accept?.includes('json') || req.is('json')) {
      return res.status(500).json({ success: false, message: errMsg });
    }
    req.flash('error_msg', errMsg);
    res.redirect('/sales/pos');
  }
};

// 4. View Retail Receipt / Printable Thermal Slip
const getSaleReceipt = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid sale ID.');
      return res.redirect('/sales');
    }

    const [sale, settings] = await Promise.all([
      Sale.findOne({ _id: id, userId }).populate('customer').populate('items.product', 'sku barcode unit'),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!sale) {
      req.flash('error_msg', 'Sale record not found.');
      return res.redirect('/sales');
    }

    const currency = settings?.currency || '₹';

    res.render('sales/receipt', {
      title: `Receipt #${sale.invoiceNumber}`,
      activeMenu: 'sales',
      sale,
      settings: settings || {},
      currency,
    });
  } catch (error) {
    console.error('[Get Sale Receipt Error]', error);
    req.flash('error_msg', 'Unable to load invoice receipt.');
    res.redirect('/sales');
  }
};

// 5. Void / Delete Sale & Restore Inventory
const deleteSale = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid sale ID.');
      return res.redirect('/sales');
    }

    const sale = await Sale.findOne({ _id: id, userId });
    if (!sale) {
      req.flash('error_msg', 'Sale record not found.');
      return res.redirect('/sales');
    }

    // 1. Restock inventory products
    for (const item of sale.items) {
      const product = await Product.findOne({ _id: item.product, userId });
      if (product) {
        const prevStock = product.currentStock;
        const newStock = prevStock + item.quantity;

        product.currentStock = newStock;
        await product.save();

        await StockMovement.create({
          userId,
          product: product._id,
          type: 'RETURN',
          quantity: item.quantity,
          previousStock: prevStock,
          newStock,
          referenceId: sale._id,
          notes: `Restocked voided sale #${sale.invoiceNumber}`,
          date: new Date(),
        });
      }
    }

    // 2. Revert customer balances if linked
    if (sale.customer) {
      const customer = await Customer.findOne({ _id: sale.customer, userId });
      if (customer) {
        customer.totalSpent = Math.max(0, (customer.totalSpent || 0) - sale.finalAmount);
        customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - sale.dueAmount);
        await customer.save();
      }
    }

    // 3. Remove attached stock movements & sale record
    await StockMovement.deleteMany({ referenceId: sale._id, type: 'SALE' });
    await Sale.deleteOne({ _id: id, userId });

    req.flash('success_msg', `Sale invoice #${sale.invoiceNumber} voided and stock restocked.`);
    res.redirect('/sales');
  } catch (error) {
    console.error('[Delete Sale Error]', error);
    req.flash('error_msg', 'Failed to void sale invoice: ' + error.message);
    res.redirect('/sales');
  }
};

module.exports = {
  getSales,
  getPOS,
  postCheckout,
  getSaleReceipt,
  deleteSale,
};
