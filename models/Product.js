const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      trim: true,
      uppercase: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
    },
    brand: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    purchasePrice: {
      type: Number,
      required: [true, 'Purchase price is required'],
      min: [0, 'Purchase price cannot be negative'],
    },
    sellingPrice: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: [0, 'Selling price cannot be negative'],
    },
    currentStock: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Stock cannot be negative'],
    },
    minimumStock: {
      type: Number,
      default: 5,
      min: 0,
    },
    recommendedStock: {
      type: Number,
      default: 20,
      min: 0,
    },
    maximumStock: {
      type: Number,
      default: 100,
      min: 0,
    },
    unit: {
      type: String,
      default: 'pcs',
      trim: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
    },
    expiryDate: {
      type: Date,
    },
    lastSoldDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

productSchema.index({ userId: 1, sku: 1 }, { unique: true });
productSchema.index({ userId: 1, name: 1 });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
