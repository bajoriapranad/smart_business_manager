const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Supplier = require('../models/Supplier');
const StockMovement = require('../models/StockMovement');
const BusinessSettings = require('../models/BusinessSettings');

// ---------------- PRODUCTS ----------------

// List Products with Search, Filtering, Sorting, and Pagination
const getProducts = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    const settings = await BusinessSettings.findOne({ userId });
    const currency = settings?.currency || '₹';

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const categoryFilter = req.query.category || '';
    const stockStatus = req.query.stockStatus || '';
    const sortBy = req.query.sort || 'createdAt_desc';

    // Build Query
    const query = { userId };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
      ];
    }

    if (categoryFilter && mongoose.Types.ObjectId.isValid(categoryFilter)) {
      query.category = new mongoose.Types.ObjectId(categoryFilter);
    }

    if (stockStatus === 'out_of_stock') {
      query.currentStock = 0;
    } else if (stockStatus === 'low_stock') {
      query.currentStock = { $gt: 0 };
      query.$expr = { $lte: ['$currentStock', '$minimumStock'] };
    } else if (stockStatus === 'in_stock') {
      query.$expr = { $gt: ['$currentStock', '$minimumStock'] };
    }

    // Build Sorting
    let sortOption = { createdAt: -1 };
    if (sortBy === 'name_asc') sortOption = { name: 1 };
    else if (sortBy === 'name_desc') sortOption = { name: -1 };
    else if (sortBy === 'stock_asc') sortOption = { currentStock: 1 };
    else if (sortBy === 'stock_desc') sortOption = { currentStock: -1 };
    else if (sortBy === 'price_asc') sortOption = { sellingPrice: 1 };
    else if (sortBy === 'price_desc') sortOption = { sellingPrice: -1 };
    else if (sortBy === 'createdAt_asc') sortOption = { createdAt: 1 };

    // Fetch Products & Total Count
    const [products, totalCount, categories] = await Promise.all([
      Product.find(query)
        .populate('category', 'name')
        .populate('supplier', 'name company')
        .sort(sortOption)
        .skip(skip)
        .limit(limit),
      Product.countDocuments(query),
      Category.find({ userId }).sort({ name: 1 }),
    ]);

    // Inventory Summary Aggregation
    const inventorySummary = await Product.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalUnits: { $sum: '$currentStock' },
          totalStockValue: { $sum: { $multiply: ['$currentStock', '$purchasePrice'] } },
          totalPotentialRevenue: { $sum: { $multiply: ['$currentStock', '$sellingPrice'] } },
        },
      },
    ]);

    const summary = {
      totalProducts: inventorySummary[0]?.totalProducts || 0,
      totalUnits: inventorySummary[0]?.totalUnits || 0,
      totalStockValue: inventorySummary[0]?.totalStockValue || 0,
      totalPotentialRevenue: inventorySummary[0]?.totalPotentialRevenue || 0,
    };

    const totalPages = Math.ceil(totalCount / limit) || 1;

    res.render('inventory/index', {
      title: 'Inventory & Products',
      activeMenu: 'inventory',
      products,
      categories,
      currency,
      summary,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount,
      },
      filters: {
        search,
        category: categoryFilter,
        stockStatus,
        sort: sortBy,
      },
    });
  } catch (error) {
    console.error('[Inventory Controller Error]', error);
    req.flash('error_msg', 'Failed to load inventory.');
    res.redirect('/dashboard');
  }
};

// Show Add Product Form
const getNewProduct = async (req, res) => {
  try {
    const userId = req.session.userId;
    const [categories, suppliers] = await Promise.all([
      Category.find({ userId }).sort({ name: 1 }),
      Supplier.find({ userId }).sort({ name: 1 }),
    ]);

    res.render('inventory/form', {
      title: 'Add New Product',
      activeMenu: 'inventory',
      isEdit: false,
      product: {},
      categories,
      suppliers,
    });
  } catch (error) {
    console.error('[Get New Product Error]', error);
    req.flash('error_msg', 'Failed to load product form.');
    res.redirect('/inventory');
  }
};

// Handle Add Product Submission
const postNewProduct = async (req, res) => {
  const userId = req.session.userId;
  const {
    name,
    sku,
    category,
    brand,
    description,
    purchasePrice,
    sellingPrice,
    currentStock,
    minimumStock,
    recommendedStock,
    maximumStock,
    unit,
    supplier,
    expiryDate,
  } = req.body;

  try {
    // Validate required
    if (!name || !sku || !category || purchasePrice === undefined || sellingPrice === undefined) {
      req.flash('error_msg', 'Please fill in all mandatory product fields.');
      return res.redirect('/inventory/new');
    }

    // SKU unique per user check
    const existingSKU = await Product.findOne({
      userId,
      sku: sku.trim().toUpperCase(),
    });
    if (existingSKU) {
      req.flash('error_msg', `A product with SKU "${sku.toUpperCase()}" already exists.`);
      return res.redirect('/inventory/new');
    }

    const productStock = Math.max(0, parseInt(currentStock) || 0);

    const newProduct = new Product({
      userId,
      name: name.trim(),
      sku: sku.trim().toUpperCase(),
      category,
      brand: brand?.trim() || '',
      description: description?.trim() || '',
      purchasePrice: parseFloat(purchasePrice) || 0,
      sellingPrice: parseFloat(sellingPrice) || 0,
      currentStock: productStock,
      minimumStock: Math.max(0, parseInt(minimumStock) || 5),
      recommendedStock: Math.max(0, parseInt(recommendedStock) || 20),
      maximumStock: Math.max(0, parseInt(maximumStock) || 100),
      unit: unit?.trim() || 'pcs',
      supplier: supplier && mongoose.Types.ObjectId.isValid(supplier) ? supplier : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    });

    await newProduct.save();

    // Log initial stock movement if stock > 0
    if (productStock > 0) {
      await StockMovement.create({
        userId,
        product: newProduct._id,
        type: 'ADJUSTMENT',
        quantity: productStock,
        previousStock: 0,
        newStock: productStock,
        notes: 'Initial inventory baseline',
      });
    }

    req.flash('success_msg', `Product "${newProduct.name}" added successfully.`);
    res.redirect('/inventory');
  } catch (error) {
    console.error('[Create Product Error]', error);
    req.flash('error_msg', 'Failed to create product: ' + error.message);
    res.redirect('/inventory/new');
  }
};

// Show Product Details
const getProductDetail = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid product ID.');
      return res.redirect('/inventory');
    }

    const [product, movements, settings] = await Promise.all([
      Product.findOne({ _id: id, userId })
        .populate('category', 'name description')
        .populate('supplier', 'name company phone email'),
      StockMovement.find({ product: id, userId }).sort({ date: -1 }).limit(10),
      BusinessSettings.findOne({ userId }),
    ]);

    if (!product) {
      req.flash('error_msg', 'Product not found.');
      return res.redirect('/inventory');
    }

    const currency = settings?.currency || '₹';
    const stockValue = product.currentStock * product.purchasePrice;
    const potentialRevenue = product.currentStock * product.sellingPrice;
    const profitMargin =
      product.sellingPrice > 0
        ? (((product.sellingPrice - product.purchasePrice) / product.sellingPrice) * 100).toFixed(1)
        : 0;

    res.render('inventory/detail', {
      title: product.name,
      activeMenu: 'inventory',
      product,
      movements,
      currency,
      calculations: {
        stockValue,
        potentialRevenue,
        profitMargin,
      },
    });
  } catch (error) {
    console.error('[Get Product Detail Error]', error);
    req.flash('error_msg', 'Failed to retrieve product details.');
    res.redirect('/inventory');
  }
};

// Show Edit Product Form
const getEditProduct = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error_msg', 'Invalid product ID.');
      return res.redirect('/inventory');
    }

    const [product, categories, suppliers] = await Promise.all([
      Product.findOne({ _id: id, userId }),
      Category.find({ userId }).sort({ name: 1 }),
      Supplier.find({ userId }).sort({ name: 1 }),
    ]);

    if (!product) {
      req.flash('error_msg', 'Product not found.');
      return res.redirect('/inventory');
    }

    res.render('inventory/form', {
      title: `Edit ${product.name}`,
      activeMenu: 'inventory',
      isEdit: true,
      product,
      categories,
      suppliers,
    });
  } catch (error) {
    console.error('[Get Edit Product Error]', error);
    req.flash('error_msg', 'Failed to load product.');
    res.redirect('/inventory');
  }
};

// Handle Edit Product Submission
const putProduct = async (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const {
    name,
    sku,
    category,
    brand,
    description,
    purchasePrice,
    sellingPrice,
    currentStock,
    minimumStock,
    recommendedStock,
    maximumStock,
    unit,
    supplier,
    expiryDate,
  } = req.body;

  try {
    const product = await Product.findOne({ _id: id, userId });
    if (!product) {
      req.flash('error_msg', 'Product not found.');
      return res.redirect('/inventory');
    }

    // SKU duplication check if changed
    const upperSKU = sku.trim().toUpperCase();
    if (upperSKU !== product.sku) {
      const existing = await Product.findOne({ userId, sku: upperSKU, _id: { $ne: id } });
      if (existing) {
        req.flash('error_msg', `SKU "${upperSKU}" is already taken by another product.`);
        return res.redirect(`/inventory/${id}/edit`);
      }
    }

    const oldStock = product.currentStock;
    const newStock = Math.max(0, parseInt(currentStock) || 0);

    // Update fields
    product.name = name.trim();
    product.sku = upperSKU;
    product.category = category;
    product.brand = brand?.trim() || '';
    product.description = description?.trim() || '';
    product.purchasePrice = parseFloat(purchasePrice) || 0;
    product.sellingPrice = parseFloat(sellingPrice) || 0;
    product.currentStock = newStock;
    product.minimumStock = Math.max(0, parseInt(minimumStock) || 5);
    product.recommendedStock = Math.max(0, parseInt(recommendedStock) || 20);
    product.maximumStock = Math.max(0, parseInt(maximumStock) || 100);
    product.unit = unit?.trim() || 'pcs';
    product.supplier = supplier && mongoose.Types.ObjectId.isValid(supplier) ? supplier : undefined;
    product.expiryDate = expiryDate ? new Date(expiryDate) : undefined;

    await product.save();

    // Log stock adjustment if stock was manually edited
    if (oldStock !== newStock) {
      await StockMovement.create({
        userId,
        product: product._id,
        type: 'ADJUSTMENT',
        quantity: newStock - oldStock,
        previousStock: oldStock,
        newStock: newStock,
        notes: 'Manual inventory adjustment via product edit',
      });
    }

    req.flash('success_msg', `Product "${product.name}" updated successfully.`);
    res.redirect(`/inventory/${product._id}`);
  } catch (error) {
    console.error('[Update Product Error]', error);
    req.flash('error_msg', 'Failed to update product: ' + error.message);
    res.redirect(`/inventory/${id}/edit`);
  }
};

// Handle Delete Product
const deleteProduct = async (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;

  try {
    const product = await Product.findOneAndDelete({ _id: id, userId });
    if (!product) {
      req.flash('error_msg', 'Product not found.');
      return res.redirect('/inventory');
    }

    // Clean up associated stock movements
    await StockMovement.deleteMany({ product: id, userId });

    req.flash('success_msg', `Product "${product.name}" deleted successfully.`);
    res.redirect('/inventory');
  } catch (error) {
    console.error('[Delete Product Error]', error);
    req.flash('error_msg', 'Failed to delete product.');
    res.redirect('/inventory');
  }
};

// ---------------- CATEGORIES ----------------

// View Category Management
const getCategories = async (req, res) => {
  try {
    const userId = req.session.userId;
    const categories = await Category.find({ userId }).sort({ name: 1 });

    // Count products per category
    const categoryCounts = await Product.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    categoryCounts.forEach((c) => {
      if (c._id) countMap[c._id.toString()] = c.count;
    });

    res.render('inventory/categories', {
      title: 'Product Categories',
      activeMenu: 'inventory',
      categories,
      countMap,
    });
  } catch (error) {
    console.error('[Get Categories Error]', error);
    req.flash('error_msg', 'Failed to load categories.');
    res.redirect('/inventory');
  }
};

// Create Category
const postCategory = async (req, res) => {
  const userId = req.session.userId;
  const { name, description } = req.body;

  try {
    if (!name || !name.trim()) {
      req.flash('error_msg', 'Category name is required.');
      return res.redirect('/inventory/categories');
    }

    const existing = await Category.findOne({ userId, name: name.trim() });
    if (existing) {
      req.flash('error_msg', `Category "${name.trim()}" already exists.`);
      return res.redirect('/inventory/categories');
    }

    await Category.create({
      userId,
      name: name.trim(),
      description: description?.trim() || '',
    });

    req.flash('success_msg', `Category "${name.trim()}" created successfully.`);
    res.redirect('/inventory/categories');
  } catch (error) {
    console.error('[Post Category Error]', error);
    req.flash('error_msg', 'Failed to create category.');
    res.redirect('/inventory/categories');
  }
};

// Update Category
const putCategory = async (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { name, description } = req.body;

  try {
    const category = await Category.findOne({ _id: id, userId });
    if (!category) {
      req.flash('error_msg', 'Category not found.');
      return res.redirect('/inventory/categories');
    }

    if (!name || !name.trim()) {
      req.flash('error_msg', 'Category name is required.');
      return res.redirect('/inventory/categories');
    }

    category.name = name.trim();
    category.description = description?.trim() || '';
    await category.save();

    req.flash('success_msg', 'Category updated successfully.');
    res.redirect('/inventory/categories');
  } catch (error) {
    console.error('[Put Category Error]', error);
    req.flash('error_msg', 'Failed to update category.');
    res.redirect('/inventory/categories');
  }
};

// Delete Category
const deleteCategory = async (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;

  try {
    // Check if products exist in this category
    const count = await Product.countDocuments({ category: id, userId });
    if (count > 0) {
      req.flash(
        'error_msg',
        `Cannot delete category. It has ${count} product(s) assigned. Reassign or delete them first.`
      );
      return res.redirect('/inventory/categories');
    }

    await Category.findOneAndDelete({ _id: id, userId });
    req.flash('success_msg', 'Category deleted successfully.');
    res.redirect('/inventory/categories');
  } catch (error) {
    console.error('[Delete Category Error]', error);
    req.flash('error_msg', 'Failed to delete category.');
    res.redirect('/inventory/categories');
  }
};

module.exports = {
  getProducts,
  getNewProduct,
  postNewProduct,
  getProductDetail,
  getEditProduct,
  putProduct,
  deleteProduct,
  getCategories,
  postCategory,
  putCategory,
  deleteCategory,
};
