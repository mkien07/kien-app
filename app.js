const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');

const app = express();

// 🔗 Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI);

// ⚙️ Cấu hình proxy để lấy IP thật
app.set('trust proxy', true);

// 🔐 Cài đặt session
app.use(session({
  secret: 'kienDangCap',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000 // Giữ phiên 7 ngày
  }
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 📦 Schema người dùng
const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  email: String,
  phone: String,
  password: String,
  balance: Number,
  investment: Number,
  registeredAt: Date,
  lastLogin: Date,
  ipRegister: String,
  ipLogin: String,
  userAgent: String,
  locked: Boolean,
  vipLevel: String,
  role: { type: String, default: 'user' }
});

const User = mongoose.model('User', userSchema);

// ✅ API kiểm tra session + quyền
app.get('/check-session', (req, res) => {
  if (req.session?.user) {
    res.json({ loggedIn: true, role: req.session.user.role });
  } else {
    res.json({ loggedIn: false });
  }
});

// ✅ Route bảo vệ
app.get('/menu.html', (req, res, next) => {
  req.session?.user ? next() : res.redirect('/index.html');
});
app.get('/reg.html', (req, res, next) => {
  req.session?.user ? res.redirect('/menu.html') : next();
});

// ✅ Đăng ký
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  const existingUser = await User.findOne({ $or: [{ username }, { email }] });
  if (existingUser) return res.status(409).send('⚠️ Tên đăng nhập hoặc email đã tồn tại!');

  const now = new Date();
  const ip = req.ip;
  const ua = req.headers['user-agent'];

  const newUser = new User({
    userId: Math.floor(100000 + Math.random() * 900000).toString(),
    username,
    email,
    phone,
    password,
    balance: 0,
    investment: 0,
    registeredAt: now,
    lastLogin: now,
    ipRegister: ip,
    ipLogin: ip,
    userAgent: ua,
    locked: false,
    vipLevel: 'VIP1',
    role: 'user'
  });

  await newUser.save();
  req.session.user = newUser;
  res.redirect('/menu.html');
});

// ✅ Đăng nhập
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;
  const ua = req.headers['user-agent'];

  if (username === 'admin' && password === 'maikien') {
    req.session.user = {
      username: 'admin',
      userId: '000000',
      email: 'admin@system.local',
      vipLevel: 'ADMIN',
      registeredAt: new Date(),
      lastLogin: new Date(),
      ipLogin: ip,
      userAgent: ua,
      role: 'admin'
    };
    return res.redirect('/data.html');
  }

  const user = await User.findOne({
    $or: [{ username }, { email: username }],
    password
  });

  if (!user || user.locked) return res.status(401).send('❌ Sai tài khoản hoặc đã bị khóa');

  user.lastLogin = new Date();
  user.ipLogin = ip;
  user.userAgent = ua;
  await user.save();

  req.session.user = user;
  return res.redirect(user.role === 'qtv' ? '/data.html' : '/menu.html');
});

// ✅ Đăng xuất
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('❌ Hủy session lỗi:', err);
      return res.status(500).send('Đăng xuất thất bại');
    }
    res.clearCookie('connect.sid', {
      path: '/',
      httpOnly: true,
      secure: false
    });
    res.redirect('/index.html');
  });
});

// ✅ File tĩnh
app.use(express.static(path.join(__dirname, '/')));

// ✅ Khởi chạy
app.listen(3000, () => {
  console.log('🚀 Server chạy tại http://localhost:3000');
});