const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');

const app = express();
app.set('trust proxy', true);

// 🔗 MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true, useUnifiedTopology: true
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'kienDangCap',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// =====================
// MODELS
// =====================
const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  email: String,
  phone: String,
  password: String,
  balance: { type: Number, default: 0 },
  investment: { type: Number, default: 0 },
  registeredAt: Date,
  lastLogin: Date,
  ipRegister: String,
  ipLogin: String,
  userAgent: String,
  locked: { type: Boolean, default: false },
  vipLevel: { type: String, default: 'VIP1' },
  role: { type: String, default: 'user' }
});
const User = mongoose.model('User', userSchema);

const withdrawSchema = new mongoose.Schema({
  userId: String,
  method: String,
  accountNumber: String,
  accountName: String,
  bankName: String,
  usdtAddress: String,
  network: String,
  amount: Number,
  status: { type: String, default: 'pending' },
  note: String, // ✅ ghi chú admin
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// =====================
// MIDDLEWARE
// =====================
function requireLogin(req, res, next) {
  req.session.user ? next() : res.redirect('/index.html');
}
function requireRole(roles) {
  return (req, res, next) => {
    const u = req.session.user;
    if (u && roles.includes(u.role)) next();
    else res.redirect('/index.html');
  };
}
function requireAdminWith(req, res, next) {
  const u = req.session.user;
  if (u && u.role === 'adminwith') next();
  else res.redirect('/index.html');
}

// =====================
// ROUTES
// =====================
app.get('/menu.html', requireLogin);
app.get('/rut.html', requireLogin);
app.get('/data.html', requireRole(['admin', 'qtv']));
app.get('/with.html', requireAdminWith);

app.get('/reg.html', (req, res, next) => {
  req.session.user ? res.redirect('/menu.html') : next();
});

// LOGIN
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === 'adminwith' && password === 'admin') {
    req.session.user = { username: 'adminwith', role: 'adminwith' };
    return res.redirect('/with.html');
  }

  if (username === 'admin' && password === 'maikien') {
    req.session.user = { username: 'admin', role: 'admin' };
    return res.redirect('/data.html');
  }

  const user = await User.findOne({
    $or: [{ username }, { email: username }], password
  });
  if (!user || user.locked) return res.status(401).send('Sai tài khoản');

  user.lastLogin = new Date();
  user.ipLogin = req.ip;
  user.userAgent = req.headers['user-agent'];
  await user.save();

  req.session.user = user;
  res.redirect('/menu.html');
});

// REGISTER
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  if (await User.findOne({ $or: [{ username }, { email }] })) {
    return res.status(409).send('Tên hoặc email đã tồn tại');
  }

  const now = new Date();
  const newUser = new User({
    userId: Math.floor(100000 + Math.random() * 900000).toString(),
    username, email, phone, password,
    registeredAt: now, lastLogin: now,
    ipRegister: req.ip, ipLogin: req.ip,
    userAgent: req.headers['user-agent']
  });
  await newUser.save();

  req.session.user = newUser;
  res.redirect('/menu.html');
});

// PROFILE
app.get('/profile', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');
  const sUser = req.session.user;
  let user = await User.findOne({ userId: sUser.userId }).lean();
  if (!user && sUser.role === 'admin') user = sUser;
  if (!user) return res.status(401).send('Không tìm thấy user');
  res.json(user);
});

// CREATE WITHDRAW
app.post('/withdraw', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');

  const { accountNumber, accountName, bankName, usdtAddress, network, amount } = req.body;
  const user = await User.findOne({ userId: req.session.user.userId });
  if (!user) return res.status(404).send('Không tìm thấy user');

  const amt = Number(amount);
  if (amt < 50000) return res.status(400).send('Số tiền tối thiểu 50.000');
  if (user.balance < amt) return res.status(400).send('Số dư không đủ');

  user.balance -= amt;
  await user.save();

  const w = new Withdraw({
    userId: user.userId,
    method: bankName ? 'bank' : 'usdt',
    accountNumber, accountName, bankName,
    usdtAddress, network, amount: amt
  });
  await w.save();

  res.json({ newBalance: user.balance });
});

// ✅ API: Lịch sử rút cho user hiện tại
app.get('/api/withdraws', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');
  const list = await Withdraw.find({ userId: req.session.user.userId })
    .sort({ createdAt: -1 }).lean();
  res.json(list);
});

// ADMIN: Danh sách đơn rút
app.get('/admin/withdraws', async (req, res) => {
  const u = req.session.user;
  if (!u || u.role !== 'adminwith') return res.status(403).send('Không có quyền');
  const list = await Withdraw.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

// ADMIN: Duyệt đơn rút
app.post('/admin/withdraw/:id/approve', async (req, res) => {
  const u = req.session.user;
  if (!u || u.role !== 'adminwith') return res.status(403).send('Không có quyền');
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('Không tìm thấy đơn');

  w.status = 'approved';
  w.note = req.body.note || ''; // ✅ lưu ghi chú
  w.updatedAt = new Date();
  await w.save();
  res.send('Đã duyệt đơn rút');
});

// ADMIN: Hủy đơn rút
app.post('/admin/withdraw/:id/cancel', async (req, res) => {
  const u = req.session.user;
  if (!u || u.role !== 'adminwith') return res.status(403).send('Không có quyền');
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('Không tìm thấy đơn');

  const user = await User.findOne({ userId: w.userId });
  if (user) {
    user.balance += w.amount;
    await user.save();
  }

  w.status = 'canceled';
  w.note = req.body.note || '';
  w.updatedAt = new Date();
  await w.save();
  res.send('Đã hủy đơn rút & hoàn tiền');
});

// ADMIN USERS (data.html)
app.get('/admin/users', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin','qtv'].includes(u.role)) return res.status(403).send('Không có quyền');
  const users = await User.find().lean();
  res.json(users);
});

// =====================
// STATIC FILES
// =====================
app.use(express.static(path.join(__dirname, '/')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));
