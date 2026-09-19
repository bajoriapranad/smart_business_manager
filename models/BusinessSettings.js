const mongoose = require('mongoose');

const businessSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    businessName: {
      type: String,
      default: 'My Retail Store',
    },
    businessPhone: {
      type: String,
      default: '',
    },
    email: {
      type: String,
      default: '',
    },
    gstin: {
      type: String,
      default: '',
    },
    address: {
      type: String,
      default: '',
    },
    currency: {
      type: String,
      default: '₹',
    },
    defaultTax: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
      min: 1,
    },
    invoiceFooterNotes: {
      type: String,
      default: 'Thank you for shopping with us! Please visit again.',
    },
    slowMovingDays: {
      type: Number,
      default: 30,
      min: 1,
    },
    verySlowMovingDays: {
      type: Number,
      default: 60,
      min: 1,
    },
    deadStockDays: {
      type: Number,
      default: 90,
      min: 1,
    },
    enableLoyalty: {
      type: Boolean,
      default: true,
    },
    defaultCustomerDiscount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    loyaltyTiers: [
      {
        name: { type: String, required: true },
        discountPercent: { type: Number, required: true, min: 0, max: 100 },
        minSpend: { type: Number, default: 0 },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const BusinessSettings = mongoose.model('BusinessSettings', businessSettingsSchema);

module.exports = BusinessSettings;
