
const express = require('express');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Configuration ---
app.use(cors());
// Increase limit for Base64 image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- Mongoose Schemas ---

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  password: { type: String, required: true }, // Note: In prod, hash this!
  role: { type: String, enum: ['admin', 'agent'], default: 'agent' },
  active: { type: Boolean, default: true },
  salesCount: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  commissionRate: { type: Number, default: 100 },
  targets: [{
    startDate: String,
    endDate: String,
    target: Number
  }]
}, { timestamps: true });

const customerSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  status: { type: String, default: 'Lead' },
  agentId: String,
  budget: Number,
  propertyId: String,
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  title: String,
  address: String,
  price: Number,
  type: { type: String, default: 'House' },
  status: { type: String, default: 'Available' },
  quantity: { type: Number, default: 1 },
  agentId: String,
  images: [String],
  vatTax: { type: Number, default: 0 },
  otherCost: { type: Number, default: 0 }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  fromId: String,
  toId: String,
  text: String,
  read: { type: Boolean, default: false },
  images: [String],
  edited: { type: Boolean, default: false }
}, { timestamps: true });

const configSchema = new mongoose.Schema({
  type: { type: String, default: 'financial' }, // Singleton
  interestIncome: { type: Number, default: 0 },
  otherIncome: { type: Number, default: 0 },
  rent: { type: Number, default: 0 },
  utilities: { type: Number, default: 0 },
  supplies: { type: Number, default: 0 },
  marketing: { type: Number, default: 0 },
  insurance: { type: Number, default: 0 },
  maintenance: { type: Number, default: 0 },
  misc: { type: Number, default: 0 },
  baseSalaries: { type: Number, default: 0 },
  depreciation: { type: Number, default: 0 },
  taxes: { type: Number, default: 0 },
});

const User = mongoose.model('User', userSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Product = mongoose.model('Product', productSchema);
const Message = mongoose.model('Message', messageSchema);
const Config = mongoose.model('Config', configSchema);

// --- Helper Functions ---

// Upload Base64 to Cloudinary
const uploadImage = async (base64Str) => {
  try {
    if (!base64Str.startsWith('data:image')) return base64Str; // Already a url
    const result = await cloudinary.uploader.upload(base64Str, {
      folder: 'ridge_park_crm'
    });
    return result.secure_url;
  } catch (error) {
    console.error("Cloudinary Upload Error:", error);
    return null;
  }
};

// Date Filtering Helpers
const getFilterQuery = (startDate, endDate, field = 'createdAt') => {
  const query = {};
  if (startDate && endDate) {
    const start = new Date(startDate); start.setHours(0,0,0,0);
    const end = new Date(endDate); end.setHours(23,59,59,999);
    query[field] = { $gte: start, $lte: end };
  }
  return query;
};

const getExistenceQuery = (endDate) => {
  if (!endDate) return {};
  const end = new Date(endDate); end.setHours(23,59,59,999);
  return { createdAt: { $lte: end } };
};

// --- Seeding ---
const seedDatabase = async () => {
  const adminExists = await User.findOne({ email: 'admin@user.com' });
  if (!adminExists) {
    console.log("🌱 Seeding Database...");
    await User.create({
      email: 'admin@user.com',
      name: 'System Admin',
      password: '123456',
      role: 'admin'
    });
    
    // Initial Config
    await Config.create({});
    console.log("✅ Database Seeded");
  }
};
seedDatabase();

// --- API Routes ---

// Auth
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email, password });
  if (user && (user.active !== false)) {
    // Convert _id to id for frontend compatibility
    const u = user.toObject();
    u.id = u._id.toString();
    delete u._id;
    delete u.password;
    res.json(u);
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if(user) {
      const u = user.toObject();
      u.id = u._id;
      res.json(u);
  } else {
      res.status(404).json(null);
  }
});

// Agents
app.get('/api/agents', async (req, res) => {
  const { endDate } = req.query;
  const query = { role: 'agent', ...getExistenceQuery(endDate) };
  const agents = await User.find(query).select('-password');
  res.json(agents.map(a => ({ ...a.toObject(), id: a._id })));
});

app.post('/api/agents', async (req, res) => {
  const agent = await User.create({ ...req.body, role: 'agent' });
  res.json({ ...agent.toObject(), id: agent._id });
});

app.put('/api/agents/:id', async (req, res) => {
  const agent = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(agent);
});

app.put('/api/agents/:id/target', async (req, res) => {
  const { startDate, endDate, target } = req.body;
  const agent = await User.findById(req.params.id);
  
  const existingIndex = agent.targets.findIndex(t => t.startDate === startDate && t.endDate === endDate);
  if (existingIndex >= 0) {
    agent.targets[existingIndex].target = target;
  } else {
    agent.targets.push({ startDate, endDate, target });
  }
  await agent.save();
  res.json(agent);
});

app.delete('/api/agents/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Customers
app.get('/api/customers', async (req, res) => {
  const { startDate, endDate } = req.query;
  let query = {};
  
  // Frontend usually wants filtering by created date for list, or specific date logic
  // Adhering to: if start/end provided -> filter createdAt inside range
  // if only end provided -> filter createdAt <= end
  if (startDate && endDate) {
      query = getFilterQuery(startDate, endDate);
  } else if (endDate) {
      query = getExistenceQuery(endDate);
  }

  const customers = await Customer.find(query).sort({ updatedAt: -1 });
  res.json(customers.map(c => ({ ...c.toObject(), id: c._id })));
});

app.post('/api/customers', async (req, res) => {
  const customer = await Customer.create(req.body);
  res.json({ ...customer.toObject(), id: customer._id });
});

app.put('/api/customers/:id', async (req, res) => {
  const { status, propertyId } = req.body;
  const customer = await Customer.findById(req.params.id);
  const oldStatus = customer.status;

  // Logic: Closing Deal Points & Inventory
  if (status === 'Closed' && oldStatus !== 'Closed') {
    // Award Points
    if (customer.agentId) {
      await User.findByIdAndUpdate(customer.agentId, { 
        $inc: { points: 10, salesCount: 1 } 
      });
    }
    // Reduce Inventory
    if (propertyId) {
      const product = await Product.findById(propertyId);
      if (product) {
        if (product.quantity > 0) product.quantity -= 1;
        if (product.quantity === 0) product.status = 'Sold';
        await product.save();
      }
    }
  }

  const updated = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updated);
});

app.delete('/api/customers/:id', async (req, res) => {
  await Customer.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Products
app.get('/api/products', async (req, res) => {
  const { endDate } = req.query;
  const query = getExistenceQuery(endDate);
  const products = await Product.find(query).sort({ createdAt: -1 });
  res.json(products.map(p => ({ ...p.toObject(), id: p._id })));
});

app.post('/api/products', async (req, res) => {
  let productData = { ...req.body };
  
  // Handle Image Uploads
  if (productData.images && productData.images.length > 0) {
    const uploadPromises = productData.images.map(img => uploadImage(img));
    productData.images = await Promise.all(uploadPromises);
  }

  const product = await Product.create(productData);
  res.json({ ...product.toObject(), id: product._id });
});

app.put('/api/products/:id', async (req, res) => {
  let productData = { ...req.body };
  
  // Auto status update based on quantity
  if (typeof productData.quantity === 'number') {
      if (productData.quantity === 0) productData.status = 'Sold';
      else if (productData.status === 'Sold' && productData.quantity > 0) productData.status = 'Available';
  }

  // Handle new images (if any base64 strings passed)
  if (productData.images) {
      const processedImages = [];
      for (const img of productData.images) {
          const url = await uploadImage(img);
          if(url) processedImages.push(url);
      }
      productData.images = processedImages;
  }

  const product = await Product.findByIdAndUpdate(req.params.id, productData, { new: true });
  res.json(product);
});

app.delete('/api/products/:id', async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Chat
app.get('/api/messages/:userId', async (req, res) => {
  const { userId } = req.params;
  const messages = await Message.find({
    $or: [{ fromId: userId }, { toId: userId }]
  }).sort({ createdAt: 1 });
  res.json(messages.map(m => ({ 
      ...m.toObject(), 
      id: m._id, 
      timestamp: m.createdAt 
  })));
});

app.post('/api/messages', async (req, res) => {
  let { fromId, toId, text, images } = req.body;
  
  if (images && images.length > 0) {
      const uploadPromises = images.map(img => uploadImage(img));
      images = await Promise.all(uploadPromises);
  }

  const message = await Message.create({ fromId, toId, text, images });
  res.json({ ...message.toObject(), id: message._id, timestamp: message.createdAt });
});

app.put('/api/messages/:id', async (req, res) => {
  await Message.findByIdAndUpdate(req.params.id, { text: req.body.text, edited: true });
  res.json({ success: true });
});

app.delete('/api/messages/:id', async (req, res) => {
  await Message.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.post('/api/messages/read', async (req, res) => {
  const { ids } = req.body;
  await Message.updateMany({ _id: { $in: ids } }, { read: true });
  res.json({ success: true });
});

// Financials
app.get('/api/financials/config', async (req, res) => {
  const { endDate } = req.query;
  
  // Check if system existed
  if (endDate) {
      const firstAgent = await User.findOne().sort({ createdAt: 1 });
      if (firstAgent && new Date(endDate) < firstAgent.createdAt) {
          // Return empty config
          return res.json({ interestIncome: 0, otherIncome: 0, rent: 0, utilities: 0, supplies: 0, marketing: 0, insurance: 0, maintenance: 0, misc: 0, baseSalaries: 0, depreciation: 0, taxes: 0 });
      }
  }

  let config = await Config.findOne();
  if (!config) config = await Config.create({});
  res.json(config);
});

app.put('/api/financials/config', async (req, res) => {
  const config = await Config.findOneAndUpdate({}, req.body, { new: true, upsert: true });
  res.json(config);
});

app.get('/api/financials/report', async (req, res) => {
  const { startDate, endDate } = req.query;
  
  // 1. Get Config
  let config = await Config.findOne();
  if(!config) config = { interestIncome: 0, otherIncome: 0, rent: 0, taxes: 0, baseSalaries: 0, utilities: 0, supplies: 0, marketing: 0, insurance: 0, maintenance: 0, misc: 0, depreciation: 0 };

  // Check emptiness
  const firstAgent = await User.findOne().sort({ createdAt: 1 });
  const isPreSystem = endDate && firstAgent && new Date(endDate) < firstAgent.createdAt;
  
  if (isPreSystem) {
      // Reset config for report if pre-system
      config = { interestIncome: 0, otherIncome: 0, rent: 0, taxes: 0, baseSalaries: 0, utilities: 0, supplies: 0, marketing: 0, insurance: 0, maintenance: 0, misc: 0, depreciation: 0 };
  }

  // 2. Calculate Revenue from Closed Deals in Range
  let closedQuery = { status: 'Closed' };
  if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0,0,0,0);
      const end = new Date(endDate); end.setHours(23,59,59,999);
      closedQuery['updatedAt'] = { $gte: start, $lte: end };
  }

  const closedCustomers = await Customer.find(closedQuery);
  
  let salesRevenue = 0;
  const soldItems = [];
  const propertyCostsDetails = [];
  let totalPropertyTransactionCosts = 0;

  // Calculate Sales Revenue & Costs
  for (const c of closedCustomers) {
      if (c.propertyId) {
          const p = await Product.findById(c.propertyId);
          if (p) {
              salesRevenue += p.price;
              soldItems.push({ title: p.title, price: p.price, date: c.updatedAt });
              
              const cost = (p.vatTax || 0) + (p.otherCost || 0);
              totalPropertyTransactionCosts += cost;
              propertyCostsDetails.push({ title: p.title, cost, breakdown: `VAT: ${p.vatTax}, Other: ${p.otherCost}` });
          }
      }
  }

  // 3. Calculate Commissions
  // We need all agents active in that period
  const agentQuery = { role: 'agent' };
  if (endDate) {
      const end = new Date(endDate); end.setHours(23,59,59,999);
      agentQuery['createdAt'] = { $lte: end };
  }
  const agents = await User.find(agentQuery);
  
  const agentCommissions = [];
  let totalCommissions = 0;

  for (const agent of agents) {
      const agentDeals = closedCustomers.filter(c => c.agentId === agent._id.toString());
      const points = agentDeals.length * 10;
      const amount = (points / 10) * agent.commissionRate;
      totalCommissions += amount;
      agentCommissions.push({ name: agent.name, amount, points });
  }

  // Aggregation
  const serviceRevenue = salesRevenue * 0.03;
  const totalIncome = salesRevenue + serviceRevenue + config.interestIncome + config.otherIncome;
  
  const totalSalaries = config.baseSalaries + totalCommissions;
  
  const operatingExpenses = config.rent + config.utilities + config.supplies + config.marketing + config.insurance + config.maintenance + config.misc;
  
  const totalExpenses = totalSalaries + operatingExpenses + config.depreciation + config.taxes + totalPropertyTransactionCosts;

  const netProfitLoss = totalIncome - totalExpenses;

  // If pre-system and no revenue, ensure 0
  if (isPreSystem && salesRevenue === 0) {
      res.json({
          income: { salesRevenue: 0, serviceRevenue: 0, interestIncome: 0, otherIncome: 0, totalIncome: 0, details: { soldProducts: [] } },
          expenses: { rent: 0, salariesWages: 0, totalExpenses: 0, propertyTransactionCosts: 0, details: { commissions: [], propertyCosts: [] } },
          netProfitLoss: 0
      });
      return;
  }

  res.json({
      income: {
          salesRevenue,
          serviceRevenue,
          interestIncome: config.interestIncome,
          otherIncome: config.otherIncome,
          totalIncome,
          details: { soldProducts: soldItems }
      },
      expenses: {
          rent: config.rent,
          salariesWages: totalSalaries,
          utilities: config.utilities,
          suppliesRawMaterials: config.supplies,
          depreciation: config.depreciation,
          taxes: config.taxes,
          insurance: config.insurance,
          marketingAdvertising: config.marketing,
          maintenanceRepairs: config.maintenance,
          miscellaneousExpenses: config.misc,
          propertyTransactionCosts: totalPropertyTransactionCosts,
          totalExpenses,
          details: {
              baseSalaries: config.baseSalaries,
              commissions: agentCommissions,
              propertyCosts: propertyCostsDetails
          }
      },
      netProfitLoss
  });
});

// Stats Endpoint
app.get('/api/stats', async (req, res) => {
    const { startDate, endDate } = req.query;
    const existenceQuery = getExistenceQuery(endDate);
    
    const activeAgents = await User.countDocuments({ role: 'agent', ...existenceQuery });
    
    // Active Listings (Available OR Quantity > 0)
    const activeProducts = await Product.countDocuments({ 
        $and: [
            existenceQuery,
            { $or: [{ status: 'Available' }, { quantity: { $gt: 0 } }] }
        ]
    });

    // New Customers in Range
    const custQuery = startDate && endDate ? getFilterQuery(startDate, endDate) : existenceQuery;
    const totalCustomers = await Customer.countDocuments(custQuery);

    // Sales Revenue in Range
    let closedQuery = { status: 'Closed' };
    if (startDate && endDate) {
        const start = new Date(startDate); start.setHours(0,0,0,0);
        const end = new Date(endDate); end.setHours(23,59,59,999);
        closedQuery['updatedAt'] = { $gte: start, $lte: end };
    }
    
    const closedDeals = await Customer.find(closedQuery);
    let totalSales = 0;
    for(const c of closedDeals) {
        if(c.propertyId) {
            const p = await Product.findById(c.propertyId);
            if(p) totalSales += p.price;
        }
    }

    res.json({
        totalSales,
        activeListings: activeProducts,
        totalCustomers,
        totalAgents: activeAgents
    });
});

// SPA Fallback
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html')); 
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

