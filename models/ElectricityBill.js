const mongoose = require('mongoose');

const electricityBillSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    meterNumber: {
      type: String,
      required: true,
      trim: true,
    },
    billingMonth: {
      type: String,
      required: true, // e.g. "2026-08"
      trim: true,
    },
    previousReading: {
      type: Number,
      required: true,
      min: 0,
    },
    currentReading: {
      type: Number,
      required: true,
      min: 0,
    },
    unitsConsumed: {
      type: Number,
      required: true,
      min: 0,
    },
    billAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    paidDate: {
      type: Date,
    },
    paymentStatus: {
      type: String,
      enum: ['Paid', 'Pending', 'Overdue'],
      default: 'Pending',
    },
    notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

electricityBillSchema.index({ userId: 1, billingMonth: -1 });

const ElectricityBill = mongoose.model('ElectricityBill', electricityBillSchema);

module.exports = ElectricityBill;
