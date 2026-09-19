# 🏢 Smart Business Manager & Profit Analyser

[![Live Demo](https://img.shields.io/badge/Live_Demo-Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)](https://smart-business-manager.onrender.com/)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-v4.21-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Bootstrap 5](https://img.shields.io/badge/Bootstrap-v5.3-7952B3?style=for-the-badge&logo=bootstrap&logoColor=white)](https://getbootstrap.com/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg?style=for-the-badge)](https://opensource.org/licenses/ISC)

> **A modern, full-stack store management system and executive financial intelligence engine designed for retail stores, supermarkets, grocery distributors, and small-to-medium businesses.**

---

## 🌐 Live Application

🚀 **Production Deployment:** [https://smart-business-manager.onrender.com/](https://smart-business-manager.onrender.com/)

### ⚡ 1-Click Instant Demo Login
Experience the complete system without filling out forms:
👉 **[Click Here to Enter Live Demo](https://smart-business-manager.onrender.com/auth/demo)**

Or log in manually with the seeded demo credentials:
* **Email:** `demo@smartbusiness.com`
* **Password:** `Demo@123`

---

## ✨ Features & Architecture

Smart Business Manager provides an integrated suite of **17 operational modules** organized into 4 business domains:

### 1. 🛒 Core Operations & Point of Sale
* **POS Terminal & Fast Checkout (`/sales/pos`):** Instant barcode/SKU search, responsive product selection grid, dynamic cart calculation, cash / card / UPI / credit tender options, and thermal printable receipts.
* **Inventory & Stock Valuation (`/inventory`):** Real-time stock counts, category categorization, low-stock threshold alerting, cost-price tracking, and automatic stock movement audit trails.
* **Purchases & Stock Replenishment (`/purchases`):** Inward batch restocking, supplier invoice management, purchase order logs, and automatic inventory increments.

### 2. 👥 People, Credit & Payroll
* **Customer CRM & Credit Ledger (`/customers`):** Customer purchase history, loyalty tier tracking (Bronze, Silver, Gold), and store credit balance (Udhar) tracking with settlement recording.
* **Supplier Directory & Payables (`/suppliers`):** Vendor contact directory, procurement volume records, outstanding balances due, and purchase settlement logs.
* **Staff Roster & Payroll Disbursement (`/staff`):** Employee profiles, salary disbursals, salary vouchers, and automatic synchronization with business operating expenses.

### 3. 💰 Finance, Dues & Working Capital
* **Operating Expense Tracking (`/expenses`):** Categorized overhead disbursements (Rent, Utilities, Maintenance, Packaging, Salaries), recurring expense tags, and payment statuses.
* **Electricity Bills & Utility Meter Tracking (`/electricity`):** Electricity meter reading logs, units consumed calculations, monthly power tariffs, and auto-synced expense records.
* **Payments & Due Reminders Hub (`/payments`):** Unified working capital control center tracking expected receivables vs committed payables with 1-click WhatsApp payment reminder links.

### 4. 📈 Business Intelligence, Analytics & Export
* **Profit Analyser & Margin Intelligence (`/profit`):** Real-time Profit & Loss (P&L) statement, Cost of Goods Sold (COGS) tracking, gross margin percentage, net margin, and breakeven point calculations.
* **Sales & Business Analytics (`/analytics`):** Interactive Chart.js graphs for daily turnover trends, payment channel breakdown, peak footfall hours (00:00 - 23:00), fast-moving inventory heroes, and stagnant dead-stock watchlists.
* **Reports & Export Engine (`/reports`):** Multi-domain Excel-ready CSV spreadsheet exports with UTF-8 Byte Order Mark (`\uFEFF`) and formal printable audit statements with letterheads.
* **Settings & Backup Engine (`/settings`):** Store identity profile, custom currency symbols (`₹`, `$`, `€`, `£`, `AED`), sales tax / GST %, receipt footer notes, loyalty tier thresholds, and 1-click full JSON database snapshot downloads.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Runtime Environment** | Node.js (v18+) |
| **Backend Framework** | Express.js (v4.21) |
| **Database & ODM** | MongoDB Atlas with Mongoose (v8.9) |
| **Session Store** | `express-session` backed by `connect-mongo` (v5.1) |
| **Template Engine** | EJS (Embedded JavaScript Templates) |
| **Styling & UI** | Vanilla CSS, Bootstrap 5.3, Bootstrap Icons |
| **Visual Charts** | Chart.js |
| **Security & Auth** | bcryptjs password hashing, Flash messaging, Trust Proxy middleware |
| **Hosting & CI/CD** | Render.com with automated GitHub CD pipeline |

---

## 🚀 Local Development Setup

### 1. Clone the Repository
```bash
git clone https://github.com/bajoriapranad/smart_business_manager.git
cd smart_business_manager
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy the template file to create your `.env`:
```bash
cp .env.example .env
```

Open `.env` and set your configuration:
```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/smart_business_manager
SESSION_SECRET=your_super_secret_session_key_2026
NODE_ENV=development
```
*(Or use your MongoDB Atlas connection string).*

### 4. Seed Sample Store Data
```bash
npm run seed
```

### 5. Start the Application
```bash
# Production start
npm start

# Development mode with hot-reloading
npm run dev
```

Open your browser at **[http://localhost:5000](http://localhost:5000)**.

---

## 📂 Project Structure

```text
smart_business_manager/
├── config/             # Database connection & Atlas DNS configuration
├── controllers/        # Business logic for all 17 domain modules
│   ├── analyticsController.js
│   ├── authController.js
│   ├── customerController.js
│   ├── dashboardController.js
│   ├── electricityController.js
│   ├── expenseController.js
│   ├── inventoryController.js
│   ├── paymentController.js
│   ├── profitController.js
│   ├── purchaseController.js
│   ├── reportController.js
│   ├── saleController.js
│   ├── settingsController.js
│   ├── staffController.js
│   └── supplierController.js
├── middleware/         # Session auth guard & global error handlers
├── models/             # Mongoose database schemas
├── public/             # Static CSS, icons, and client-side JavaScript
├── routes/             # Modular Express routers
├── seed/               # Initial store database seeder (seed.js)
├── views/              # EJS server-rendered templates & partials
├── .env.example        # Environment variables template
├── .gitignore          # Git exclusion rules
├── app.js              # Express app entrypoint & middleware configuration
├── package.json        # Project metadata, scripts, and dependencies
└── README.md           # Documentation & guides
```

---

## 🔒 Security & Best Practices
* **Zero Credential Leaks:** `.env` and sensitive files are strictly excluded via `.gitignore`.
* **Reverse Proxy Trust:** `trust proxy` enabled for secure SSL session cookies on cloud providers (Render, Heroku).
* **Excel-Safe CSV Export:** UTF-8 BOM (`\uFEFF`) and RFC-4180 cell sanitization prevent formula injection and text corruption in Microsoft Excel and Google Sheets.
* **Audit-Proof Relational Safeguards:** Deletion protections prevent cascading loss of inventory or financial ledger history when active transactions exist.

---

## 📄 License
This project is open-source under the [ISC License](LICENSE).
