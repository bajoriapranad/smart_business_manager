const mongoose = require('mongoose');
const dns = require('node:dns');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

dotenv.config();

const User = require('../models/User');
const BusinessSettings = require('../models/BusinessSettings');
const Category = require('../models/Category');
const Supplier = require('../models/Supplier');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const Purchase = require('../models/Purchase');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');

async function seedDemoData() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_business_manager';
    await mongoose.connect(mongoUri);
    console.log('[Seed] Connected to MongoDB for Demo Seeding');

    const demoEmail = 'demo@smartbusiness.com';
    let demoUser = await User.findOne({ email: demoEmail });

    if (!demoUser) {
      console.log('[Seed] Creating fresh Demo User...');
      demoUser = new User({
        name: 'Demo Business Owner',
        email: demoEmail,
        phone: '9999999999',
        businessName: 'Apex Retail Store (Demo)',
        password: 'Demo@123',
        isDemoUser: true,
      });
      await demoUser.save();
    } else {
      console.log('[Seed] Updating existing Demo User credentials...');
      demoUser.isDemoUser = true;
      demoUser.name = 'Demo Business Owner';
      demoUser.businessName = 'Apex Retail Store (Demo)';
      demoUser.password = 'Demo@123';
      await demoUser.save();
    }

    const demoUserId = demoUser._id;

    // Clean only demo user's previous data to allow idempotent re-seeding
    await Promise.all([
      BusinessSettings.deleteMany({ userId: demoUserId }),
      Category.deleteMany({ userId: demoUserId }),
      Supplier.deleteMany({ userId: demoUserId }),
      Customer.deleteMany({ userId: demoUserId }),
      Product.deleteMany({ userId: demoUserId }),
      StockMovement.deleteMany({ userId: demoUserId }),
      Purchase.deleteMany({ userId: demoUserId }),
      Sale.deleteMany({ userId: demoUserId }),
      Expense.deleteMany({ userId: demoUserId }),
    ]);

    // 1. Business Settings
    await BusinessSettings.create({
      userId: demoUserId,
      businessName: 'Apex Retail Store (Demo)',
      businessPhone: '9999999999',
      address: 'Shop #14, Main Market, Delhi',
      currency: '₹',
      defaultTax: 5,
      lowStockThreshold: 10,
      slowMovingDays: 30,
      verySlowMovingDays: 60,
      deadStockDays: 90,
      defaultCustomerDiscount: 0,
      loyaltyTiers: [
        { name: 'Standard', discountPercent: 0, minSpend: 0 },
        { name: 'Regular', discountPercent: 2, minSpend: 5000 },
        { name: 'Frequent', discountPercent: 5, minSpend: 15000 },
        { name: 'VIP', discountPercent: 10, minSpend: 30000 },
      ],
    });

    // 2. Categories
    const [catGrocery, catBeverage, catDairy, catPersonal] = await Category.insertMany([
      { userId: demoUserId, name: 'Groceries & Staples', description: 'Grains, flour, rice, and pulses' },
      { userId: demoUserId, name: 'Beverages', description: 'Tea, coffee, packaged juices' },
      { userId: demoUserId, name: 'Dairy & Bakery', description: 'Milk, butter, bakery products' },
      { userId: demoUserId, name: 'Personal Care', description: 'Soaps, shampoos, hygiene items' },
    ]);

    // 3. Suppliers
    const [supMetro, supFresh] = await Supplier.insertMany([
      {
        userId: demoUserId,
        name: 'Metro Wholesale Ltd',
        company: 'Metro Cash & Carry India',
        phone: '9811002233',
        email: 'orders@metrowholesale.in',
        address: 'Wholesale Depot, Ring Road',
        gstNumber: '07AAAAA0000A1Z5',
        paymentTerms: 'Net 15',
        totalPurchases: 25000,
        amountPaid: 20000,
        amountDue: 5000,
      },
      {
        userId: demoUserId,
        name: 'Fresh Agro Foods',
        company: 'Fresh Agro Corp',
        phone: '9822114455',
        email: 'agro@freshfoods.com',
        address: 'Sector 4, Mandi Complex',
        gstNumber: '07BBBBB1111B2Z6',
        paymentTerms: 'Net 30',
        totalPurchases: 18000,
        amountPaid: 18000,
        amountDue: 0,
      },
    ]);

    // 4. Customers
    const [custRahul, custPriya] = await Customer.insertMany([
      {
        userId: demoUserId,
        name: 'Rahul Sharma',
        phone: '9876543210',
        email: 'rahul.s@example.com',
        address: 'Flat 402, Sunshine Apts',
        discountPercentage: 10,
        loyaltyLevel: 'VIP',
        totalSpent: 34500,
        outstandingBalance: 0,
        notes: 'Preferred weekend shopper',
      },
      {
        userId: demoUserId,
        name: 'Priya Verma',
        phone: '9811223344',
        email: 'priya.v@example.com',
        address: 'House 12, Civil Lines',
        discountPercentage: 5,
        loyaltyLevel: 'Frequent',
        totalSpent: 16200,
        outstandingBalance: 1200,
        notes: 'Monthly bulk orders',
      },
    ]);

    // 5. Products
    const [prodRice, prodOil, prodAtta, prodTea] = await Product.insertMany([
      {
        userId: demoUserId,
        name: 'Royal Basmati Rice 5kg',
        sku: 'RCE-5KG-01',
        category: catGrocery._id,
        brand: 'Royal Feast',
        description: 'Aged long grain premium basmati',
        purchasePrice: 320,
        sellingPrice: 420,
        currentStock: 25,
        minimumStock: 8,
        recommendedStock: 30,
        maximumStock: 100,
        unit: 'bag',
        supplier: supMetro._id,
        lastSoldDate: new Date(),
      },
      {
        userId: demoUserId,
        name: 'Sunlight Sunflower Oil 1L',
        sku: 'OIL-1L-02',
        category: catGrocery._id,
        brand: 'Sunlight',
        description: 'Refined sunflower cooking oil pouch',
        purchasePrice: 110,
        sellingPrice: 145,
        currentStock: 4, // Below minimum stock = LOW STOCK
        minimumStock: 10,
        recommendedStock: 40,
        maximumStock: 120,
        unit: 'pouch',
        supplier: supFresh._id,
        lastSoldDate: new Date(),
      },
      {
        userId: demoUserId,
        name: 'Whole Wheat Atta 10kg',
        sku: 'ATA-10KG-03',
        category: catGrocery._id,
        brand: 'Annapurna',
        description: '100% whole grain chakki fresh flour',
        purchasePrice: 310,
        sellingPrice: 390,
        currentStock: 18,
        minimumStock: 10,
        recommendedStock: 35,
        maximumStock: 80,
        unit: 'bag',
        supplier: supMetro._id,
        lastSoldDate: new Date(),
      },
      {
        userId: demoUserId,
        name: 'Premium Assam CTC Tea 500g',
        sku: 'TEA-500G-04',
        category: catBeverage._id,
        brand: 'Red Leaf',
        description: 'Strong CTC orthodox tea blend',
        purchasePrice: 140,
        sellingPrice: 210,
        currentStock: 15,
        minimumStock: 5,
        recommendedStock: 25,
        maximumStock: 60,
        unit: 'box',
        supplier: supFresh._id,
        lastSoldDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago = Slow moving
      },
    ]);

    // 6. Purchases
    const purchase1 = await Purchase.create({
      userId: demoUserId,
      supplier: supMetro._id,
      invoiceNumber: 'INV-PUR-2026-001',
      items: [
        {
          product: prodRice._id,
          quantity: 25,
          purchasePrice: 320,
          subtotal: 8000,
        },
        {
          product: prodAtta._id,
          quantity: 20,
          purchasePrice: 310,
          subtotal: 6200,
        },
      ],
      totalAmount: 14200,
      paidAmount: 14200,
      remainingAmount: 0,
      paymentStatus: 'Paid',
      purchaseDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      notes: 'Monthly staples replenishment',
    });

    // Stock Movements for Purchase
    await StockMovement.insertMany([
      {
        userId: demoUserId,
        product: prodRice._id,
        type: 'PURCHASE',
        quantity: 25,
        previousStock: 0,
        newStock: 25,
        referenceId: purchase1._id,
        notes: 'Invoice INV-PUR-2026-001',
      },
      {
        userId: demoUserId,
        product: prodAtta._id,
        type: 'PURCHASE',
        quantity: 20,
        previousStock: 0,
        newStock: 20,
        referenceId: purchase1._id,
        notes: 'Invoice INV-PUR-2026-001',
      },
    ]);

    // 7. Sales
    const sale1 = await Sale.create({
      userId: demoUserId,
      invoiceNumber: 'INV-2026-0001',
      customer: custRahul._id,
      customerName: custRahul.name,
      customerPhone: custRahul.phone,
      items: [
        {
          product: prodRice._id,
          name: prodRice.name,
          quantity: 2,
          unitPrice: 420,
          purchasePrice: 320,
          subtotal: 840,
        },
        {
          product: prodOil._id,
          name: prodOil.name,
          quantity: 3,
          unitPrice: 145,
          purchasePrice: 110,
          subtotal: 435,
        },
      ],
      subtotalAmount: 1275,
      discountPercentage: 10,
      discountAmount: 127.5,
      finalAmount: 1147.5,
      costOfGoodsSold: 2 * 320 + 3 * 110, // 640 + 330 = 970
      grossProfit: 1147.5 - 970, // 177.5
      paymentMethod: 'UPI',
      paymentStatus: 'Paid',
      paidAmount: 1147.5,
      dueAmount: 0,
      saleDate: new Date(),
      notes: 'Loyalty VIP discount applied',
    });

    // Stock Movements for Sale
    await StockMovement.insertMany([
      {
        userId: demoUserId,
        product: prodRice._id,
        type: 'SALE',
        quantity: -2,
        previousStock: 27,
        newStock: 25,
        referenceId: sale1._id,
        notes: 'Invoice INV-2026-0001',
      },
      {
        userId: demoUserId,
        product: prodOil._id,
        type: 'SALE',
        quantity: -3,
        previousStock: 7,
        newStock: 4,
        referenceId: sale1._id,
        notes: 'Invoice INV-2026-0001',
      },
    ]);

    // 8. Expenses
    await Expense.insertMany([
      {
        userId: demoUserId,
        title: 'Store Rent - September',
        category: 'Rent',
        amount: 15000,
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        paymentStatus: 'Paid',
        recurring: true,
        notes: 'Paid via Bank Transfer',
      },
      {
        userId: demoUserId,
        title: 'Store Electricity Bill',
        category: 'Electricity',
        amount: 3240,
        date: new Date(),
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        paymentStatus: 'Pending',
        recurring: false,
        notes: 'Due in 5 days',
      },
      {
        userId: demoUserId,
        title: 'High-speed Fiber Internet',
        category: 'Internet',
        amount: 999,
        date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        paymentStatus: 'Paid',
        recurring: true,
      },
    ]);

    console.log('[Seed] Demo data successfully seeded for User: demo@smartbusiness.com');
  } catch (error) {
    console.error('[Seed Error] Failed to seed demo data:', error);
  } finally {
    if (require.main === module) {
      await mongoose.disconnect();
      console.log('[Seed] Disconnected from MongoDB');
    }
  }
}

if (require.main === module) {
  seedDemoData();
}

module.exports = seedDemoData;
