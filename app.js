// app.js

const express       = require('express');
const bodyParser    = require('body-parser');
const mongoose      = require('mongoose');
const path          = require('path');
const session       = require('express-session');

const app = express();

// ⚙️ Nếu chạy sau proxy/nginx, để req.ip đúng với IP thật
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
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// 🧩 Schema User
const userSchema = new mongoose.Schema({
  userId:      String,
  username:    String,
  email:       String,
  phone:       String,
  password:    String,
  balance:     Number,
  investment:  Number,
  registeredAt:Date,
  lastLogin:   Date,
  ipRegister:  String,
  ipLogin:     String,
  userAgent:   String,
  locked:      Boolean,
  vipLevel:    String,
  role:        { type: String, default: 'user' }
});
const User = mongoose.model('User', userSchema);

// 🎲 Sinh random userId
function generateUserId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🔐 Cấu hình session
app.use(session({
  secret: 'kienDangCap',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// 🌍 Body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🔒 Bảo vệ trang menu, redirect nếu chưa login
app.get('/menu.html', (req, res, next) => {
  req.session.user ? next() : res.redirect('/index.html');
});
// Nếu đã login rồi thì không cho vào trang đăng ký
app.get('/reg.html', (req, res, next) => {
  req.session.user ? res.redirect('/menu.html') : next();
});


// 🔍 API Profile (cập nhật để rut.html lấy được balance)
app.get('/profile', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('❌ Chưa đăng nhập');
  }

  try {
    // Lấy user mới nhất từ DB
    const user = await User.findOne({ userId: req.session.user.userId }).lean();
    if (!user) {
      req.session.destroy();
      return res.status(401).send('❌ Tài khoản không tồn tại!');
    }

    // Nếu đã bị khóa
    if (user.locked) {
      req.session.destroy();
      return res.status(403).send('🔒 Tài khoản đã bị khóa!');
    }

    // Trả về full object user, bao gồm balance
    return res.json(user);

  } catch (error) {
    console.error('❌ Lỗi khi fetch profile:', error);
    return res.status(500).send('❌ Lỗi server');
  }
});

// 🔑 Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Tài khoản admin tạm
  if (username === 'admin' && password === 'maikien') {
    req.session.user = {
      username: 'admin',
      userId:   '000000',
      email:    'admin@system.local',
      vipLevel: 'ADMIN',
      registeredAt: new Date(),
      lastLogin:    new Date(),
      role: 'admin'
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
  const redirectTo = user.role === 'qtv' ? '/data.html' : '/menu.html';
  return res.redirect(redirectTo);
});

// ✍️ Register
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  if (await User.findOne({ $or: [{ username }, { email }] })) {
    return res.status(409).send('⚠️ Tên hoặc email đã tồn tại!');
  }

  const now = new Date();
  const newUser = new User({
    userId:      generateUserId(),
    username,
    email,
    phone,
    password,
    balance:     0,
    investment:  0,
    registeredAt: now,
    lastLogin:   now,
    ipRegister:  req.ip,
    ipLogin:     req.ip,
    userAgent:   req.headers['user-agent'],
    locked:      false,
    vipLevel:    'VIP1',
    role:        'user'
  });
  await newUser.save();
  req.session.user = newUser;
  res.redirect('/menu.html');
});

// 🚪 Logout
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Đăng xuất thất bại');
    res.clearCookie('connect.sid', { path: '/', httpOnly: true, secure: false });
    res.redirect('/index.html');
  });
});

// 🔧 API quản lý user (admin & qtv)
app.get('/admin/users', async (req, res) => {
  const role    = req.session.user?.role;
  const isAdmin = req.session.user?.username === 'admin';
  if (!req.session.user || (!['admin', 'qtv'].includes(role) && !isAdmin)) {
    return res.status(403).send('❌ Không có quyền');
  }

  const users = await User.find().lean();
  // build warning map
  const ipMap    = {};
  const emailMap = {};
  const phoneMap = {};
  users.forEach(u => {
    ipMap[u.ipRegister]    = (ipMap[u.ipRegister] || 0) + 1;
    emailMap[u.email]      = (emailMap[u.email] || 0) + 1;
    phoneMap[u.phone]      = (phoneMap[u.phone] || 0) + 1;
  });
  users.forEach(u => {
    u.warning = ipMap[u.ipRegister] > 1 ||
                emailMap[u.email]     > 1 ||
                phoneMap[u.phone]     > 1;
  });

  res.json(users);
});

// PUT cập nhật user (admin/qtv)
app.put('/admin/user/:id', async (req, res) => {
  const role    = req.session.user?.role;
  const isAdmin = req.session.user?.username === 'admin';
  if (!req.session.user || (!['admin', 'qtv'].includes(role) && !isAdmin)) {
    return res.status(403).send('❌ Không có quyền');
  }

  if (role === 'qtv') {
    // QTV chỉ đổi trạng thái khóa
    await User.findByIdAndUpdate(req.params.id, { locked: req.body.locked });
    return res.send('✅ QTV đã cập nhật trạng thái tài khoản');
  }

  // Admin có thể update đầy đủ
  const { email, password, balance, investment, vipLevel, locked, role: newRole } = req.body;
  await User.findByIdAndUpdate(req.params.id, {
    email, password, balance, investment, vipLevel, locked, role: newRole
  });
  res.send('✅ Admin đã cập nhật tài khoản');
});

// POST lock/unlock user
app.post('/admin/user/:id/lock', async (req, res) => {
  const u = await User.findById(req.params.id);
  u.locked = !u.locked;
  await u.save();
  res.send('✅ Đã thay đổi trạng thái khóa');
});

// POST cộng tiền vào balance
app.post('/admin/user/:id/balance', async (req, res) => {
  const { amount } = req.body;
  const u = await User.findById(req.params.id);
  u.balance += Number(amount);
  await u.save();
  res.send('✅ Đã cộng tiền');
});

// DELETE user
app.delete('/admin/user/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.send('✅ Đã xóa tài khoản');
});

// 📂 Serve static files
app.use(express.static(path.join(__dirname, '/')));

// 🚀 Khởi động server
app.listen(3000, () => {
  console.log('🚀 Server chạy http://localhost:3000');
});