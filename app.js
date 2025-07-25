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

// 🧩 Mô hình dữ liệu
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

// 🔐 Cài đặt session
app.use(session({
  secret: 'kienDangCap',
  resave: false,
  saveUninitialized: false
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ API kiểm tra phiên đăng nhập
app.get('/check-session', (req, res) => {
  res.json({ loggedIn: !!req.session.user });
});

// ✅ Bảo vệ truy cập /menu.html
app.get('/menu.html', (req, res, next) => {
  req.session.user ? next() : res.redirect('/index.html');
});

app.get('/reg.html', (req, res, next) => {
  req.session.user ? res.redirect('/menu.html') : next();
});

// ✅ API lấy thông tin người dùng
app.get('/profile', async (req, res) => {
  if (!req.session.user) return res.status(401).send('❌ Chưa đăng nhập');

  if (req.session.user.username === 'admin') return res.json(req.session.user);

  const updatedUser = await User.findById(req.session.user._id);
  if (!updatedUser) {
    req.session.destroy();
    return res.status(401).send('❌ Tài khoản không tồn tại!');
  }

  if (updatedUser.locked) {
    req.session.destroy();
    return res.status(403).send('🔒 Tài khoản bị khóa!');
  }

  res.json(updatedUser);
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

  if (!user || user.locked) {
    return res.status(401).send('❌ Sai tài khoản hoặc đã bị khóa');
  }

  user.lastLogin = new Date();
  user.ipLogin = ip;
  user.userAgent = ua;
  await user.save();

  req.session.user = user;

  if (user.role === 'qtv') return res.redirect('/data.html');
  return res.redirect('/menu.html');
});

// ✅ Đăng ký
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  const ip = req.ip;
  const ua = req.headers['user-agent'];

  const existingUser = await User.findOne({ $or: [{ username }, { email }] });
  if (existingUser) return res.status(409).send('⚠️ Tài khoản hoặc email đã tồn tại');

  const now = new Date();
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

// ✅ Đăng xuất
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/index.html');
});

// ✅ Quản lý user (Admin / QTV)
app.get('/admin/users', async (req, res) => {
  const role = req.session.user?.role;
  const isAdmin = req.session.user?.username === 'admin';
  if (!req.session.user || (!['admin', 'qtv'].includes(role) && !isAdmin)) {
    return res.status(403).send('❌ Không có quyền');
  }
  const users = await User.find();
  res.json(users);
});

app.put('/admin/user/:id', async (req, res) => {
  const role = req.session.user?.role;
  const isAdmin = req.session.user?.username === 'admin';

  if (!req.session.user || (!['admin', 'qtv'].includes(role) && !isAdmin)) {
    return res.status(403).send('❌ Không có quyền');
  }

  if (role === 'qtv') {
    await User.findByIdAndUpdate(req.params.id, {
      locked: req.body.locked
    });
    return res.send('✅ QTV đã cập nhật trạng thái tài khoản');
  }

  const {
    email, password,
    balance, investment,
    vipLevel, locked,
    role: newRole
  } = req.body;

  await User.findByIdAndUpdate(req.params.id, {
    email, password,
    balance, investment,
    vipLevel, locked,
    role: newRole
  });

  res.send('✅ Admin đã cập nhật tài khoản');
});

app.post('/admin/user/:id/lock', async (req, res) => {
  const user = await User.findById(req.params.id);
  user.locked = !user.locked;
  await user.save();
  res.send('✅ Đã thay đổi trạng thái khóa');
});

app.post('/admin/user/:id/balance', async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.params.id);
  user.balance += amount;
  await user.save();
  res.send('✅ Đã cộng tiền');
});

app.delete('/admin/user/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.send('✅ Đã xóa tài khoản');
});

// ✅ File tĩnh
app.use(express.static(path.join(__dirname, '/')));

// ✅ Chạy server
app.listen(3000, () => {
  console.log('🚀 Server đang chạy tại http://localhost:3000');
});