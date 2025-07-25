
const express       = require('express');
const bodyParser    = require('body-parser');
const mongoose      = require('mongoose');
const path          = require('path');
const session       = require('express-session');

const app = express();

// ⚙️ Lấy IP thật sau proxy/nginx
app.set('trust proxy', true);

// 🌐 Middleware check IP
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
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// 🧩 Schema user
const userSchema = new mongoose.Schema({
  userId:       String,
  username:     String,
  email:        String,
  phone:        String,
  password:     String,
  balance:      Number,
  investment:   Number,
  registeredAt: Date,
  lastLogin:    Date,
  ipRegister:   String,
  ipLogin:      String,
  userAgent:    String,
  locked:       Boolean,
  vipLevel:     String,
  role:         { type: String, default: 'user' }
});

const User = mongoose.model('User', userSchema);

// 🎲 Sinh random UID
function generateUserId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🔐 Cấu hình session
app.use(session({
  secret: 'kienDangCap',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7*24*60*60*1000 }
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🔐 Bảo vệ các trang cần login
const requireLogin = (page) => (req, res, next) => {
  req.session.user
    ? next()
    : res.redirect('/index.html');
};

app.get('/menu.html', requireLogin());
app.get('/data.html', requireLogin());
app.get('/rut.html', requireLogin());      // Bảo vệ trang rút tiền
app.get('/reg.html', (req, res, next) => {
  req.session.user ? res.redirect('/menu.html') : next();
});

// 🔍 API profile (chứa số dư)
app.get('/profile', async (req, res) => {
  const s = req.session.user;
  if (!s) return res.status(401).send('❌ Chưa đăng nhập');
  if (s.username === 'admin') return res.json(s);

  const u = await User.findOne({ userId: s.userId });
  if (!u) {
    req.session.destroy();
    return res.status(401).send('❌ Tài khoản không tồn tại!');
  }
  if (u.locked) {
    req.session.destroy();
    return res.status(403).send('🔒 Tài khoản đã bị khóa!');
  }
  // cập nhật session.user để luôn đồng bộ số dư nếu cần
  req.session.user = u;
  res.json(u);
});

// 🔑 Đăng nhập
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (username==='admin' && password==='maikien') {
    req.session.user = {
      username:'admin',
      userId:'000000',
      email:'admin@system.local',
      vipLevel:'ADMIN',
      registeredAt:new Date(),
      lastLogin:new Date(),
      role:'admin'
    };
    return res.redirect('/data.html');
  }

  const u = await User.findOne({
    $or: [{ username }, { email: username }],
    password
  });
  if (!u || u.locked) {
    return res.status(401).send('❌ Sai tài khoản hoặc đã bị khóa');
  }

  u.lastLogin = new Date();
  u.ipLogin   = req.ip;
  u.userAgent = req.headers['user-agent'];
  await u.save();

  req.session.user = u;
  return res.redirect(u.role==='qtv'?'/data.html':'/menu.html');
});

// ✍️ Đăng ký
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  if (await User.findOne({ $or:[{username},{email}] })) {
    return res.status(409).send('⚠️ Tên hoặc email đã tồn tại!');
  }
  const now = new Date();
  const u = new User({
    userId: generateUserId(),
    username, email, phone, password,
    balance:0, investment:0,
    registeredAt:now, lastLogin:now,
    ipRegister:req.ip, ipLogin:req.ip,
    userAgent:req.headers['user-agent'],
    locked:false, vipLevel:'VIP1', role:'user'
  });
  await u.save();
  req.session.user = u;
  res.redirect('/menu.html');
});

// 🚪 Đăng xuất
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Đăng xuất thất bại');
    res.clearCookie('connect.sid',{ path:'/', httpOnly:true, secure:false });
    res.redirect('/index.html');
  });
});

// 💸 API Rút tiền
app.post('/withdraw', async (req, res) => {
  // chỉ cho user thường (role=user) hoặc qtv/admin đều ok
  const s = req.session.user;
  if (!s) return res.status(401).json({ message:'❌ Chưa đăng nhập' });

  const { method, amount, accountNumber, accountName, bankName, usdtAddress, network } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ message:'❌ Số tiền không hợp lệ' });
  }

  // tải lại user từ DB để cập nhật số dư mới nhất
  const u = await User.findOne({ userId: s.userId });
  if (!u) return res.status(404).json({ message:'❌ Tài khoản không tồn tại' });
  if (u.balance < amt) {
    return res.status(400).json({ message:'❌ Số dư không đủ' });
  }

  // có thể validate thêm thông tin bank/usdt...
  // trừ số dư và lưu
  u.balance -= amt;
  await u.save();

  // cập nhật session cho trang tiếp theo
  req.session.user = u;

  // TODO: ghi log/lệnh rút vào collection khác nếu cần
  return res.json({
    message: `✅ Rút ${amt.toLocaleString('vi-VN')} thành công`,
    newBalance: u.balance
  });
});

// 🔧 API admin/users có cảnh báo (không đổi)
app.get('/admin/users', async (req, res) => {
  // ... giữ nguyên như cũ ...
});

// 🛠️ Các route admin khác giữ nguyên...

// 📁 Phục vụ file tĩnh
app.use(express.static(path.join(__dirname, '/')));

// 🚀 Khởi chạy server
app.listen(3000, () => {
  console.log('🚀 Server đang chạy tại http://localhost:3000');
});