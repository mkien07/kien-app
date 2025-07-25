

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');

const app = express();
// ⬆️ Đặt ngay sau phần tạo app
app.set('trust proxy', true);

// 🛡️ Middleware check IP & log
app.use((req, res, next) => {
  const ip = req.ip;
  console.log('🌐 Truy cập từ IP:', ip);

  // Nếu muốn chặn IP thì dùng như sau:
  // const blockedIps = ['111.222.333.444'];
  // if (blockedIps.includes(ip)) {
  //   return res.status(403).send('⛔ IP bị chặn');
  // }

  next();
});

// 🔗 Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

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
  role: { type: String, default: 'user' } // user, qtv, admin
});

const User = mongoose.model('User', userSchema);

// 🔧 Tạo mã UID ngẫu nhiên
function generateUserId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🔐 Cài đặt session
app.use(session({
  secret: 'kienDangCap',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000 // lưu session 7 ngày
  }
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ Bảo vệ truy cập /menu.html
app.get('/menu.html', (req, res, next) => {
  req.session.user ? next() : res.redirect('/index.html');
});

app.get('/reg.html', (req, res, next) => {
  req.session.user ? res.redirect('/menu.html') : next();
});

// ✅ API lấy thông tin người dùng hiện tại
app.get('/profile', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).send('❌ Chưa đăng nhập');

  if (user.username === 'admin') return res.json(user); // admin dùng session object

  const updatedUser = await User.findOne({ userId: user.userId }); // 🛠 fix lỗi _id với admin
  if (!updatedUser) {
    req.session.destroy(() => {});
    return res.status(401).send('❌ Tài khoản không tồn tại!');
  }

  if (updatedUser.locked) {
    req.session.destroy(() => {});
    return res.status(403).send('🔒 Tài khoản đã bị khóa!');
  }

  res.json(updatedUser);
});

// ✅ Đăng nhập
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === 'admin' && password === 'maikien') {
    req.session.user = {
      username: 'admin',
      userId: '000000',
      email: 'admin@system.local',
      vipLevel: 'ADMIN',
      registeredAt: new Date(),
      lastLogin: new Date(),
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
  user.ipLogin = req.ip;
  user.userAgent = req.headers['user-agent'];
  await user.save();

  req.session.user = user;

  return res.redirect(user.role === 'qtv' ? '/data.html' : '/menu.html');
});

// ✅ Đăng ký
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  const existingUser = await User.findOne({ $or: [{ username }, { email }] });

  if (existingUser) {
    return res.status(409).send('⚠️ Tên đăng nhập hoặc email đã tồn tại!');
  }

  const now = new Date();
  const newUser = new User({
    userId: generateUserId(),
    username, email, phone, password,
    balance: 0, investment: 0,
    registeredAt: now, lastLogin: now,
    ipRegister: req.ip,
    ipLogin: req.ip,
    userAgent: req.headers['user-agent'],
    locked: false,
    vipLevel: 'VIP1',
    role: 'user'
  });

  await newUser.save();
  req.session.user = newUser;
  res.redirect('/menu.html');
});

// ✅ Đăng xuất mạnh tay
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('❌ Lỗi hủy session:', err);
      return res.status(500).send('Đăng xuất thất bại');
    }

    res.clearCookie('connect.sid', {
      path: '/',
      httpOnly: true,
      secure: false
    });

    req.session = null;
    res.redirect('/index.html');
  });
});

// ✅ Quản trị: danh sách user
app.get('/admin/users', async (req, res) => {
  const role = req.session.user?.role;
  const isAdmin = req.session.user?.username === 'admin';
  if (!req.session.user || (!['admin', 'qtv'].includes(role) && !isAdmin)) {
    return res.status(403).send('❌ Không có quyền');
  }
  const users = await User.find();
  res.json(users);
});

// ✅ Quản trị: cập nhật user
app.put('/admin/user/:id', async (req, res) => {
  const role = req.session.user?.role;
  const isAdmin = req.session.user?.username === 'admin';
  if (!req.session.user || (!['admin', 'qtv'].includes(role) && !isAdmin)) {
    return res.status(403).send('❌ Không có quyền');
  }

  if (role === 'qtv') {
    await User.findByIdAndUpdate(req.params.id, { locked: req.body.locked });
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

// ✅ Khóa/Mở user
app.post('/admin/user/:id/lock', async (req, res) => {
  const user = await User.findById(req.params.id);
  user.locked = !user.locked;
  await user.save();
  res.send('✅ Đã thay đổi trạng thái khóa');
});

// ✅ Cộng tiền
app.post('/admin/user/:id/balance', async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.params.id);
  user.balance += amount;
  await user.save();
  res.send('✅ Đã cộng tiền');
});

// ✅ Xóa tài khoản
app.delete('/admin/user/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.send('✅ Đã xóa tài khoản');
});

// ✅ Phục vụ file tĩnh
app.use(express.static(path.join(__dirname, '/')));

// ✅ Khởi chạy server
app.listen(3000, () => {
  console.log('🚀 Server đang chạy tại http://localhost:3000');
});