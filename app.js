const express     = require('express');
const mongoose    = require('mongoose');
const session     = require('express-session');
const path        = require('path');

const app = express();
app.set('trust proxy', true);

// 🌐 Log IP
app.use((req, res, next) => {
  console.log('🌐 IP:', req.ip);
  next();
});

// 🔗 Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'kienDangCap',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ========== MODELS ==========
const userSchema = new mongoose.Schema({
  userId: String, username: String, email: String, phone: String, password: String,
  balance: { type: Number, default: 0 }, investment: { type: Number, default: 0 },
  registeredAt: Date, lastLogin: Date,
  ipRegister: String, ipLogin: String, userAgent: String,
  locked: { type: Boolean, default: false },
  vipLevel: { type: String, default: 'VIP1' },
  role: { type: String, default: 'user' }
});
const User = mongoose.model('User', userSchema);

const withdrawSchema = new mongoose.Schema({
  userId: String, method: String,
  accountNumber: String, accountName: String, bankName: String,
  usdtAddress: String, network: String, amount: Number,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// ========== PAGE PROTECT ==========
function requireLogin(req, res, next) {
  req.session.user ? next() : res.redirect('/index.html');
}
function requireAdmin(req, res, next) {
  const u = req.session.user;
  if (u && u.role === 'admin') return next();
  res.status(403).send('❌ Không có quyền');
}
function requireAdminWith(req, res, next) {
  const u = req.session.user;
  if (u && u.role === 'adminwith') return next();
  res.status(403).send('❌ Không có quyền');
}

// User pages
app.get('/menu.html', requireLogin);
app.get('/rut.html', requireLogin);

// Admin page
app.get('/data.html', requireAdmin);

// AdminWith page
app.get('/with.html', requireAdminWith);

// ========== LOGIN ==========
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // ✅ adminwith -> with.html
  if (username === 'admin1' && password === 'admin') {
    req.session.user = { username:'admin1', userId:'ADMINWITH', role:'adminwith' };
    return res.redirect('/with.html');
  }

  // ✅ admin -> data.html
  if (username === 'admin' && password === 'maikien') {
    req.session.user = { username:'admin', userId:'000000', role:'admin' };
    return res.redirect('/data.html');
  }

  // ✅ user thường
  const user = await User.findOne({ $or:[{username},{email:username}], password });
  if (!user || user.locked) return res.status(401).send('❌ Sai tài khoản hoặc bị khóa');

  user.lastLogin = new Date();
  user.ipLogin = req.ip;
  user.userAgent = req.headers['user-agent'];
  await user.save();

  req.session.user = user;
  const dest = (user.role === 'qtv') ? '/data.html' : '/menu.html';
  res.redirect(dest);
});

// ========== REGISTER ==========
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  if (await User.findOne({ $or:[{username},{email}] })) {
    return res.status(409).send('⚠️ Tên hoặc email đã tồn tại!');
  }
  const now = new Date();
  const newUser = new User({
    userId: Math.floor(100000 + Math.random()*900000).toString(),
    username, email, phone, password,
    registeredAt: now, lastLogin: now,
    ipRegister: req.ip, ipLogin: req.ip, userAgent: req.headers['user-agent']
  });
  await newUser.save();
  req.session.user = newUser;
  res.redirect('/menu.html');
});

app.get('/logout', (req, res) => {
  req.session.destroy(()=> res.redirect('/index.html'));
});

// ========== PROFILE ==========
app.get('/profile', async (req, res) => {
  if (!req.session.user) return res.status(401).send('❌ Chưa đăng nhập');
  const sUser = req.session.user;
  let user = await User.findOne({ userId: sUser.userId }).lean();
  if (!user && sUser.role === 'admin') user = sUser;
  if (!user) return res.status(401).send('❌ Tài khoản không tồn tại!');
  res.json(user);
});

// ========== WITHDRAW ==========
app.post('/withdraw', async (req, res) => {
  if (!req.session.user) return res.status(401).send('❌ Chưa đăng nhập');
  const { accountNumber, accountName, bankName, usdtAddress, network, amount } = req.body;
  const user = await User.findOne({ userId: req.session.user.userId });
  if (!user) return res.status(404).send('❌ Không tìm thấy user');

  const amt = Number(amount);
  if (amt < 50000) return res.status(400).send('⚠️ Tối thiểu 50.000₫');
  if (user.balance < amt) return res.status(400).send('⚠️ Số dư không đủ');

  user.balance -= amt;
  await user.save();

  const w = new Withdraw({
    userId: user.userId, method: bankName ? 'bank':'usdt',
    accountNumber, accountName, bankName, usdtAddress, network, amount: amt
  });
  await w.save();

  res.json({ newBalance: user.balance });
});

// ========== ADMIN USERS ==========
app.get('/admin/users', requireAdmin, async (req, res) => {
  const users = await User.find().lean();
  res.json(users);
});

app.put('/admin/user/:id', requireAdmin, async (req, res) => {
  const allowed = ['email','password','balance','investment','vipLevel','locked','role'];
  const data = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });

  await User.findByIdAndUpdate(req.params.id, data);
  res.send('✅ Đã cập nhật user');
});

// ========== ADMIN WITHDRAWS ==========
app.get('/admin/withdraws', requireAdminWith, async (req, res) => {
  const list = await Withdraw.find().sort({ createdAt:-1 }).lean();
  res.json(list);
});

app.post('/admin/withdraw/:id/approve', requireAdminWith, async (req, res) => {
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('❌ Không tìm thấy đơn');
  w.status = 'Duyệt'; w.updatedAt = new Date();
  await w.save();
  res.send('✅ Đã duyệt đơn rút');
});

app.post('/admin/withdraw/:id/cancel', requireAdminWith, async (req, res) => {
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('❌ Không tìm thấy đơn');
  const user = await User.findOne({ userId: w.userId });
  if (user) { user.balance += w.amount; await user.save(); }

  w.status = 'Hủy'; w.updatedAt = new Date();
  await w.save();
  res.send('✅ Đã hủy & hoàn tiền');
});

// ========== STATIC ==========
app.use(express.static(path.join(__dirname, '/')));

// ========== START ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`🚀 Server: http://localhost:${PORT}`));

