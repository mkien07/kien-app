// app.js

const express       = require('express');
const mongoose      = require('mongoose');
const session       = require('express-session');
const path          = require('path');

const app = express();

// ⚙️ Nếu chạy sau proxy/nginx, để req.ip đúng IP thật
app.set('trust proxy', true);

// 🌐 Middleware chặn IP
app.use((req, res, next) => {
  const ip = req.ip;
  console.log('🌐 Truy cập từ IP:', ip);

  const blockedIps = ['111.222.333.444'];
  if (blockedIps.includes(ip)) {
    return res.status(403).send('⛔ IP bị chặn');
  }
  next();
});

// 🔗 Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser:    true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ====================
// 🧩 MODELS
// ====================

// User schema
const userSchema = new mongoose.Schema({
  userId:      String,
  username:    String,
  email:       String,
  phone:       String,
  password:    String,
  balance:     { type: Number, default: 0 },
  investment:  { type: Number, default: 0 },
  registeredAt:Date,
  lastLogin:   Date,
  ipRegister:  String,
  ipLogin:     String,
  userAgent:   String,
  locked:      { type: Boolean, default: false },
  vipLevel:    { type: String, default: 'VIP1' },
  role:        { type: String, default: 'user' }
});
const User = mongoose.model('User', userSchema);

// Withdraw request schema
const withdrawSchema = new mongoose.Schema({
  userId:        String,
  method:        String,      // 'bank' or 'usdt'
  accountNumber: String,
  accountName:   String,
  bankName:      String,
  usdtAddress:   String,
  network:       String,
  amount:        Number,
  status:        { type: String, default: 'pending' }, // pending|approved|canceled
  createdAt:     { type: Date, default: Date.now },
  updatedAt:     Date
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// 🎲 Sinh random UID
function generateUserId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ====================
// 🛡️ MIDDLEWARES & PARSERS
// ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret:           'kienDangCap',
  resave:           false,
  saveUninitialized:false,
  cookie: { maxAge: 7*24*60*60*1000 }
}));

// ====================
// 🔒 PROTECT STATIC PAGES
// ====================

// menu.html chỉ cho user đã login
app.get('/menu.html', (req, res, next) => {
  req.session.user ? next() : res.redirect('/index.html');
});

// rut.html chỉ cho user đã login
app.get('/rut.html', (req, res, next) => {
  req.session.user ? next() : res.redirect('/index.html');
});

// data.html chỉ cho admin/qtv
app.get('/data.html', (req, res, next) => {
  const u = req.session.user;
  if (u && (u.role === 'admin' || u.role === 'qtv')) next();
  else res.redirect('/index.html');
});

// reg.html nếu đã login thì redirect về menu
app.get('/reg.html', (req, res, next) => {
  req.session.user ? res.redirect('/menu.html') : next();
});

// ====================
// 🔍 API: PROFILE
// ====================
app.get('/profile', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('❌ Chưa đăng nhập');
  }

  const sessionUser = req.session.user;

  try {
    // Thử lấy từ DB
    let user = await User.findOne({ userId: sessionUser.userId }).lean();

    // Nếu không tìm thấy nhưng là admin thì dùng session
    if (!user && sessionUser.role === 'admin') {
      user = sessionUser;
      user.balance = user.balance || 0;
    }
    if (!user) {
      req.session.destroy();
      return res.status(401).send('❌ Tài khoản không tồn tại!');
    }

    // Khóa tài khoản
    if (user.locked) {
      req.session.destroy();
      return res.status(403).send('🔒 Tài khoản đã bị khóa!');
    }

    return res.json(user);

  } catch (err) {
    console.error('❌ Lỗi fetch profile:', err);
    return res.status(500).send('❌ Lỗi server');
  }
});

// ====================
// 🔑 API: LOGIN
// ====================
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Admin tạm
  if (username === 'admin' && password === 'maikien') {
    req.session.user = {
      username:'admin',
      userId:  '000000',
      email:   'admin@system.local',
      vipLevel:'ADMIN',
      registeredAt: new Date(),
      lastLogin:    new Date(),
      role:    'admin'
    };
    return res.redirect('/data.html');
  }

  // Kiểm tra user thường
  const user = await User.findOne({
    $or: [ { username }, { email: username } ],
    password
  });
  if (!user || user.locked) {
    return res.status(401).send('❌ Sai tài khoản hoặc đã bị khóa');
  }

  user.lastLogin = new Date();
  user.ipLogin   = req.ip;
  user.userAgent = req.headers['user-agent'];
  await user.save();

  req.session.user = user;
  const redirectTo = (user.role === 'qtv' ? '/data.html' : '/menu.html');
  return res.redirect(redirectTo);
});

// ====================
// ✍️ API: REGISTER
// ====================
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  if (await User.findOne({ $or: [ { username }, { email } ] })) {
    return res.status(409).send('⚠️ Tên hoặc email đã tồn tại!');
  }

  const now = new Date();
  const newUser = new User({
    userId:      generateUserId(),
    username, email, phone, password,
    registeredAt:now, lastLogin:now,
    ipRegister:  req.ip, ipLogin: req.ip,
    userAgent:   req.headers['user-agent']
  });
  await newUser.save();

  req.session.user = newUser;
  return res.redirect('/menu.html');
});

// ====================
// 🚪 API: LOGOUT
// ====================
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Đăng xuất thất bại');
    res.clearCookie('connect.sid');
    return res.redirect('/index.html');
  });
});

// ====================
// 💸 API: CREATE WITHDRAW REQUEST (user)
// ====================
app.post('/withdraw', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('❌ Chưa đăng nhập');
  }

  const {
    accountNumber, accountName, bankName,
    usdtAddress, network, amount
  } = req.body;

  const w = new Withdraw({
    userId:        req.session.user.userId,
    method:        bankName ? 'bank' : 'usdt',
    accountNumber, accountName, bankName,
    usdtAddress,   network,
    amount:        Number(amount)
  });
  await w.save();
  return res.send('✅ Đã gửi yêu cầu rút tiền');
});

// ====================
// 📋 API: GET USERS (admin/qtv)
// ====================
app.get('/admin/users', async (req, res) => {
  const u = req.session.user;
  if (!u || (u.role !== 'admin' && u.role !== 'qtv')) {
    return res.status(403).send('❌ Không có quyền');
  }

  const users = await User.find().lean();
  // đánh dấu cảnh báo duplicate
  const ipMap = {}, emailMap = {}, phoneMap = {};
  users.forEach(x => {
    ipMap[x.ipRegister]    = (ipMap[x.ipRegister] || 0) + 1;
    emailMap[x.email]      = (emailMap[x.email] || 0) + 1;
    phoneMap[x.phone]      = (phoneMap[x.phone] || 0) + 1;
  });
  users.forEach(x => {
    x.warning = ipMap[x.ipRegister] > 1
             || emailMap[x.email]     > 1
             || phoneMap[x.phone]     > 1;
  });

  return res.json(users);
});

// ====================
// 📋 API: GET WITHDRAW REQUESTS (admin/qtv)
// ====================
app.get('/admin/withdraws', async (req, res) => {
  const u = req.session.user;
  if (!u || (u.role !== 'admin' && u.role !== 'qtv')) {
    return res.status(403).send('❌ Không có quyền');
  }
  const list = await Withdraw.find().sort({ createdAt: -1 }).lean();
  return res.json(list);
});

// ✅ API: Approve a withdraw
app.post('/admin/withdraw/:id/approve', async (req, res) => {
  const u = req.session.user;
  if (!u || (u.role !== 'admin' && u.role !== 'qtv')) {
    return res.status(403).send('❌ Không có quyền');
  }
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('❌ Không tìm thấy đơn');
  w.status    = 'approved';
  w.updatedAt = new Date();
  await w.save();
  return res.send('✅ Đã duyệt đơn rút');
});

// ❌ API: Cancel a withdraw
app.post('/admin/withdraw/:id/cancel', async (req, res) => {
  const u = req.session.user;
  if (!u || (u.role !== 'admin' && u.role !== 'qtv')) {
    return res.status(403).send('❌ Không có quyền');
  }
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('❌ Không tìm thấy đơn');
  w.status    = 'canceled';
  w.updatedAt = new Date();
  await w.save();
  return res.send('✅ Đã hủy đơn rút');
});

// ====================
// 📂 SERVE STATIC FILES
// ====================
app.use(express.static(path.join(__dirname, '/')));

// ====================
// 🚀 START SERVER
// ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy http://localhost:${PORT}`);
});