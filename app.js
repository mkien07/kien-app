const express     = require('express');
const mongoose    = require('mongoose');
const session     = require('express-session');
const path        = require('path');

const app = express();

// ⚙️ Nếu chạy sau proxy/nginx, để req.ip đúng IP thật
app.set('trust proxy', true);

// 🌐 Middleware chặn IP
app.use((req, res, next) => {
  console.log('🌐 Truy cập từ IP:', req.ip);
  const blocked = ['111.222.333.444'];
  if (blocked.includes(req.ip)) {
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

// =====================
// 🛠️ PARSERS & SESSION
// =====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'kienDangCap',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ================
// 🧩 MODELS
// ================
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
  vipLevel:    { type: String,  default: 'VIP1' },
  role:        { type: String,  default: 'user' }
});
const User = mongoose.model('User', userSchema);

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

// =====================
// 🔒 PAGE PROTECTION
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

// menu & rut cho user đã login
app.get('/menu.html', requireLogin);
app.get('/rut.html',  requireLogin);

// data.html & duyettien.html cho admin/qtv
app.get('/data.html',        requireRole(['admin','qtv']));
app.get('/duyettien.html',   requireRole(['admin','qtv']));

// reg.html nếu đã login thì redirect về menu
app.get('/reg.html', (req, res, next) => {
  req.session.user ? res.redirect('/menu.html') : next();
});

// ================
// 🔑 AUTH ROUTES
// ================
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Admin tạm
  if (username === 'admin' && password === 'maikien') {
    req.session.user = {
      username:'admin',
      userId:  '000000',
      email:   'admin@system.local',
      vipLevel:'ADMIN',
      lastLogin: new Date(),
      role:    'admin'
    };
    return res.redirect('/data.html');
  }

  // User thường
  const user = await User.findOne({
    $or: [{ username }, { email: username }],
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
  const dest = (user.role === 'qtv') ? '/data.html' : '/menu.html';
  res.redirect(dest);
});

app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  if (await User.findOne({ $or:[{username},{email}] })) {
    return res.status(409).send('⚠️ Tên hoặc email đã tồn tại!');
  }

  const now = new Date();
  const newUser = new User({
    userId:      Math.floor(100000 + Math.random() * 900000).toString(),
    username, email, phone, password,
    registeredAt: now,
    lastLogin:    now,
    ipRegister:   req.ip,
    ipLogin:      req.ip,
    userAgent:    req.headers['user-agent']
  });
  await newUser.save();

  req.session.user = newUser;
  res.redirect('/menu.html');
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Đăng xuất thất bại');
    res.clearCookie('connect.sid');
    res.redirect('/index.html');
  });
});

// ================
// 🔍 API: PROFILE
// ================
app.get('/profile', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('❌ Chưa đăng nhập');
  }

  try {
    const sUser = req.session.user;
    let user = await User.findOne({ userId: sUser.userId }).lean();

    // Nếu admin (không có DB record) dùng luôn session
    if (!user && sUser.role === 'admin') {
      user = sUser;
      user.balance = user.balance || 0;
    }
    if (!user) {
      req.session.destroy();
      return res.status(401).send('❌ Tài khoản không tồn tại!');
    }
    if (user.locked) {
      req.session.destroy();
      return res.status(403).send('🔒 Tài khoản đã bị khóa!');
    }

    res.json(user);
  } catch (err) {
    console.error('❌ Lỗi /profile:', err);
    res.status(500).send('❌ Lỗi server');
  }
});

// ===================================
// 💸 API: CREATE WITHDRAW REQUEST
// ===================================
app.post('/withdraw', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('❌ Chưa đăng nhập');
  }

  const {
    accountNumber, accountName, bankName,
    usdtAddress, network, amount
  } = req.body;

  // Tạo đơn, tính phí & số tiền thực nhận sẽ làm sau
  const w = new Withdraw({
    userId:        req.session.user.userId,
    method:        bankName ? 'bank' : 'usdt',
    accountNumber, accountName, bankName,
    usdtAddress,   network,
    amount:        Number(amount)
  });
  await w.save();

  res.send('✅ Yêu cầu rút tiền đã gửi');
});

// ========================================
// 📋 API: USER MANAGEMENT (admin/qtv)
// ========================================
app.get('/admin/users', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin','qtv'].includes(u.role)) {
    return res.status(403).send('❌ Không có quyền');
  }

  const users = await User.find().lean();
  // Đánh dấu cảnh báo duplicate
  const ipMap = {}, emailMap = {}, phoneMap = {};
  users.forEach(x => {
    ipMap[x.ipRegister] = (ipMap[x.ipRegister] || 0) + 1;
    emailMap[x.email]   = (emailMap[x.email]   || 0) + 1;
    phoneMap[x.phone]   = (phoneMap[x.phone]   || 0) + 1;
  });
  users.forEach(x => {
    x.warning = ipMap[x.ipRegister] > 1
             || emailMap[x.email]    > 1
             || phoneMap[x.phone]    > 1;
  });

  res.json(users);
});

app.put('/admin/user/:id', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin','qtv'].includes(u.role)) {
    return res.status(403).send('❌ Không có quyền');
  }

  // Chỉ update những field cho phép
  const allowed = ['email','password','balance','investment','vipLevel','locked','role'];
  const data = {};
  allowed.forEach(k => {
    if (req.body[k] !== undefined) data[k] = req.body[k];
  });

  await User.findByIdAndUpdate(req.params.id, data);
  res.send('✅ Đã cập nhật user');
});

// =========================================
// 📋 API: WITHDRAW MANAGEMENT (admin/qtv)
// =========================================
app.get('/admin/withdraws', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin','qtv'].includes(u.role)) {
    return res.status(403).send('❌ Không có quyền');
  }
  const list = await Withdraw.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

app.post('/admin/withdraw/:id/approve', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin','qtv'].includes(u.role)) {
    return res.status(403).send('❌ Không có quyền');
  }
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('❌ Không tìm thấy đơn');
  w.status    = 'approved';
  w.updatedAt = new Date();
  await w.save();
  res.send('✅ Đã duyệt đơn rút');
});

app.post('/admin/withdraw/:id/cancel', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin','qtv'].includes(u.role)) {
    return res.status(403).send('❌ Không có quyền');
  }
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('❌ Không tìm thấy đơn');
  w.status    = 'canceled';
  w.updatedAt = new Date();
  await w.save();
  res.send('✅ Đã hủy đơn rút');
});

// =====================
// 📂 SERVE STATIC FILES
// =====================
app.use(express.static(path.join(__dirname, '/')));

// =====================
// 🚀 START SERVER
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên http://localhost:${PORT}`);
});
