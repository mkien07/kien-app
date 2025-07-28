const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');

const app = express();
app.set('trust proxy', true);

// ✅ Kết nối MongoDB
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
  note: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

const depositSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  note: String,
  status: { type: String, default: 'approved' },
  createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

const logSchema = new mongoose.Schema({
  actor: String,
  action: String,
  targetUserId: String,
  oldData: Object,
  newData: Object,
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', logSchema);

// ✅ Investment model
const investSchema = new mongoose.Schema({
  userId: String,
  package: String,   // '100k' hoặc '300k'
  amount: Number,
  profitRate: Number,
  days: Number,
  profitDays: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  createdAt: { type: Date, default: Date.now },
  lastProfitAt: Date
});
const Investment = mongoose.model('Investment', investSchema);

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
function requireAdHist(req, res, next) {
  const u = req.session.user;
  if (u && u.username === 'ad' && u.role === 'ad') next();
  else res.redirect('/index.html');
}

// =====================
// ROUTES
// =====================
app.get('/menu.html', requireLogin);
app.get('/rut.html', requireLogin);
app.get('/data.html', requireRole(['admin','qtv']));
app.get('/with.html', requireAdminWith);
app.get('/histori.html', requireAdHist);

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
  if (username === 'ad' && password === 'ad') {
    req.session.user = { username: 'ad', role: 'ad' };
    return res.redirect('/histori.html');
  }

  const user = await User.findOne({ $or:[{username},{email:username}], password });
  if (!user || user.locked) return res.status(401).send('Sai tài khoản');

  user.lastLogin = new Date();
  user.ipLogin   = req.ip;
  user.userAgent = req.headers['user-agent'];
  await user.save();

  await new Log({
    actor: user.username,
    action: 'Đăng nhập',
    targetUserId: user.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

  req.session.user = user;
  res.redirect('/menu.html');
});

// REGISTER
app.post('/register', async (req, res) => {
  const { username, email, phone, password } = req.body;
  if (await User.findOne({ $or:[{username},{email}] })) {
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

  await new Log({
    actor: username,
    action: 'Đăng ký tài khoản',
    targetUserId: newUser.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

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
  if (amt < 50000)      return res.status(400).send('Số tiền tối thiểu 50.000');
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

  await new Log({
    actor: user.username,
    action: 'Tạo đơn rút',
    targetUserId: user.userId,
    newData: { amount: amt },
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

  res.json({ newBalance: user.balance });
});

// API: LỊCH SỬ RÚT
app.get('/api/withdraws', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');
  const list = await Withdraw.find({ userId: req.session.user.userId })
                     .sort({ createdAt: -1 }).lean();
  res.json(list);
});

// API: LỊCH SỬ NẠP
app.get('/api/deposits', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');
  const list = await Deposit.find({ userId: req.session.user.userId })
                    .sort({ createdAt: -1 }).lean();
  res.json(list);
});

// ✅ ĐẦU TƯ
app.post('/invest', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');
  const { package } = req.body;
  const user = await User.findOne({ userId: req.session.user.userId });
  if (!user) return res.status(404).send('User không tồn tại');

  let amount, rate, days;
  if (package === '100k') { amount = 100000; rate = 0.4; days = 3; }
  else if (package === '300k') { amount = 300000; rate = 0.3; days = 4; }
  else return res.status(400).send('Gói không hợp lệ');

  if (user.balance < amount) return res.status(400).send('Số dư không đủ');

  user.balance -= amount;
  user.investment += amount;
  await user.save();

  await new Investment({
    userId: user.userId,
    package, amount,
    profitRate: rate,
    days,
    lastProfitAt: new Date()
  }).save();

  await new Log({
    actor: user.username,
    action: 'Đầu tư gói ' + package,
    targetUserId: user.userId,
    newData: { amount },
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

  res.json({ newBalance: user.balance });
});

// API: Lấy gói đầu tư của user
app.get('/api/investments', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');
  const list = await Investment.find({ userId: req.session.user.userId, status: 'active' }).lean();
  res.json(list);
});

// ✅ Cronjob cộng lãi
cron.schedule('* * * * *', async () => { //chỉnh * thành 0
  const now = new Date();
  const all = await Investment.find({ status: 'active' });
  for (let inv of all) {
    const diff = (now - inv.lastProfitAt) / (1000*60); // 1 ngày 1000*60*60*24
    if (diff >= 1) {
      const profit = inv.amount * inv.profitRate;
      await User.updateOne({ userId: inv.userId }, { $inc: { balance: profit } });
      inv.profitDays += 1;
      inv.lastProfitAt = now;

      if (inv.profitDays >= inv.days) {
        inv.status = 'finished';
        await User.updateOne({ userId: inv.userId }, { $inc: { investment: -inv.amount } });
      }

      await inv.save();
      await new Log({
        actor: 'system',
        action: 'Cộng lãi',
        targetUserId: inv.userId,
        newData: { profit },
        createdAt: now
      }).save();
    }
  }
});

// ADMINWITH: QUẢN LÝ RÚT
app.get('/admin/withdraws', async (req, res) => {
  const u = req.session.user;
  if (!u || u.role !== 'adminwith') return res.status(403).send('Không có quyền');
  const list = await Withdraw.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});
app.post('/admin/withdraw/:id/approve', async (req, res) => {
  const u = req.session.user;
  if (!u || u.role !== 'adminwith') return res.status(403).send('Không có quyền');
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('Không tìm thấy đơn');
  const oldStatus = w.status;
  w.status = 'approved';
  w.note   = req.body.note || '';
  w.updatedAt = new Date();
  await w.save();

  await new Log({
    actor: u.username,
    action: 'Duyệt đơn rút',
    targetUserId: w.userId,
    oldData: { status: oldStatus },
    newData: { status: 'approved' },
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

  res.send('Đã duyệt đơn rút');
});
app.post('/admin/withdraw/:id/cancel', async (req, res) => {
  const u = req.session.user;
  if (!u || u.role !== 'adminwith') return res.status(403).send('Không có quyền');
  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).send('Không tìm thấy đơn');
  const usr = await User.findOne({ userId: w.userId });
  if (usr) {
    usr.balance += w.amount; await usr.save();
  }
  const oldStatus = w.status;
  w.status    = 'canceled';
  w.note      = req.body.note || '';
  w.updatedAt = new Date();
  await w.save();

  await new Log({
    actor: u.username,
    action: 'Hủy đơn rút',
    targetUserId: w.userId,
    oldData: { status: oldStatus },
    newData: { status: 'canceled' },
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

  res.send('Đã hủy đơn rút & hoàn tiền');
});

// ADMIN USERS (data.html)
app.get('/admin/users', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin','qtv'].includes(u.role)) return res.status(403).send('Không có quyền');
  const users = await User.find().lean();
  res.json(users);
});

// ADMIN: CẬP NHẬT USER & LƯU LOG
app.put('/admin/user/:userId', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin','qtv'].includes(u.role)) return res.status(403).send('Không có quyền');

  const user = await User.findOne({ userId: req.params.userId });
  if (!user) return res.status(404).send('User không tồn tại');

  const oldData = {
    email: user.email, password: user.password, balance: user.balance,
    investment: user.investment, vipLevel: user.vipLevel,
    role: user.role, locked: user.locked
  };

  const fields = ['email','password','balance','investment','vipLevel','locked','role'];
  fields.forEach(f => { if (req.body[f] !== undefined) user[f] = req.body[f]; });
  await user.save();

  const newData = {
    email: user.email, password: user.password, balance: user.balance,
    investment: user.investment, vipLevel: user.vipLevel,
    role: user.role, locked: user.locked
  };

  if (req.body.balance !== undefined && req.body.balance !== oldData.balance) {
    const diff = req.body.balance - oldData.balance;
    await new Deposit({
      userId: user.userId,
      amount: Math.abs(diff),
      note: diff > 0 ? 'Admin cộng tiền' : 'Admin trừ tiền'
    }).save();
  }

  await new Log({
    actor: u.username,
    action: 'Cập nhật user',
    targetUserId: user.userId,
    oldData,
    newData,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

  res.send('Đã cập nhật user');
});

// ✅ API: Lịch sử log cho histori.html
app.get('/admin/logs', async (req, res) => {
  const u = req.session.user;
  if (!u || u.username !== 'ad' || u.role !== 'ad') return res.status(403).send('Không có quyền');
  const logs = await Log.find().sort({ createdAt: -1 }).lean();
  res.json(logs);
});

// STATIC FILES
app.use(express.static(path.join(__dirname, '/')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));

