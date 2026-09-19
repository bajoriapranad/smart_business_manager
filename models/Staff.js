const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Staff name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    position: {
      type: String,
      required: [true, 'Position is required'],
      trim: true,
    },
    joiningDate: {
      type: Date,
      default: Date.now,
    },
    salary: {
      type: Number,
      required: [true, 'Salary amount is required'],
      min: 0,
    },
    salaryFrequency: {
      type: String,
      enum: ['Monthly', 'Weekly', 'Daily'],
      default: 'Monthly',
    },
    paymentDay: {
      type: Number,
      default: 1, // Day of the month
      min: 1,
      max: 31,
    },
    status: {
      type: String,
      enum: ['Active', 'On Leave', 'Inactive'],
      default: 'Active',
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

staffSchema.index({ userId: 1, name: 1 });

const Staff = mongoose.model('Staff', staffSchema);

module.exports = Staff;
