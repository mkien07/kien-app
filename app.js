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
  inviterId: { type: String, default: null },
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

const investSchema = new mongoose.Schema({
  userId: String,
  package: String,
  amount: Number,
  profitRate: Number,
  days: Number,
  profitDays: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  createdAt: { type: Date, default: Date.now },
  lastProfitAt: Date
});
const Investment = mongoose.model('Investment', investSchema);

// ✨ Lưu log ai mời ai
const inviteLogSchema = new mongoose.Schema({
  userId: String,        // Người vừa nhập mã
  inviterId: String,     // Người mời
  timestamp: { type: Date, default: Date.now }
});
const InviteLog = mongoose.model('InviteLog', inviteLogSchema);

// ✨ Lưu hoa hồng đã trả
const commissionLogSchema = new mongoose.Schema({
  fromUserId: String,    // Người nạp tiền
  toUserId: String,      // Người nhận hoa hồng
  sourceAmount: Number,  // Số tiền gốc nạp
  amount: Number,        // Hoa hồng đã trả
  timestamp: { type: Date, default: Date.now }
});
const CommissionLog = mongoose.model('CommissionLog', commissionLogSchema);

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

app.get('/reg.html', async (req, res, next) => {
  if (req.query.ref) {
    const inviter = await User.findOne({ userId: req.query.ref });
    if (inviter) req.session.refUserId = req.query.ref;
  }
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
  if (inviterId === username) {
  return res.status(400).send('Không thể tự mời chính mình');
 }
  const { username, email, phone, password } = req.body;
  const inviterId = req.session.refUserId || null;
  if (await User.findOne({ $or:[{username},{email}] })) {
    return res.status(409).send('Tên hoặc email đã tồn tại');
  }
  const now = new Date();
  const newUser = new User({
    userId: Math.floor(100000 + Math.random() * 900000).toString(),
    username, email, phone, password,
    registeredAt: now, lastLogin: now,
    ipRegister: req.ip, ipLogin: req.ip,
    userAgent: req.headers['user-agent'],
    inviterId
  });
  await newUser.save();
  if (inviterId) {
  await new InviteLog({ userId: newUser.userId, inviterId }).save();
  }
  req.session.refUserId = null;

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
  const list = await Withdraw.find({ userId: req.session.user.userId }).sort({ createdAt: -1 }).lean();
  res.json(list);
});

// API: LỊCH SỬ NẠP
app.get('/api/deposits', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');
  const list = await Deposit.find({ userId: req.session.user.userId }).sort({ createdAt: -1 }).lean();
  res.json(list);
});

// ✅ ĐẦU TƯ (chỉ 1 gói hoạt động mỗi lần)
app.post('/invest', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập' });

  const { plan } = req.body;
  const user = await User.findOne({ userId: req.session.user.userId });
  if (!user) return res.status(404).json({ error: 'User không tồn tại' });

  // Kiểm tra nếu user đã có gói đang hoạt động
  const activeInvestment = await Investment.findOne({ userId: user.userId, status: 'active' });
  if (activeInvestment) {
    return res.status(400).json({ error: 'Bạn đã có gói đầu tư đang hoạt động. Vui lòng chờ kết thúc gói hiện tại.' });
  }

  let amount, rate, days;
  if (plan === '100000') { amount = 100000; rate = 0.4; days = 3; }
  else if (plan === '300000') { amount = 300000; rate = 0.3; days = 4; }
  else return res.status(400).json({ error: 'Gói không hợp lệ' });

  if (user.balance < amount) {
    return res.status(400).json({ error: 'Số dư không đủ để đầu tư gói này.' });
  }

  user.balance -= amount;
  user.investment += amount;
  await user.save();

  await new Investment({
    userId: user.userId,
    package: plan,
    amount,
    profitRate: rate,
    days,
    lastProfitAt: new Date()
  }).save();

  await new Log({
    actor: user.username,
    action: 'Đầu tư gói ' + plan,
    targetUserId: user.userId,
    newData: { amount },
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

  res.json({ message: 'Đầu tư thành công', newBalance: user.balance });
});

// API: Lấy gói đầu tư của user
app.get('/api/investments', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Chưa đăng nhập');
  const list = await Investment.find({ userId: req.session.user.userId, status: 'active' }).lean();
  res.json(list);
});

// ✅ Admin API: Lấy danh sách gói đầu tư của user
app.get('/my/investments', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Bạn chưa đăng nhập' });
  }

  try {
    const list = await Investment.find({ userId: req.session.user.userId }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server khi truy xuất dữ liệu đầu tư' });
  }
});

// ✅ Admin API: Xóa gói đầu tư
app.delete('/admin/investments/:userId', async (req, res) => {
  const u = req.session.user;
  if (!u || !['admin', 'qtv'].includes(u.role)) {
    return res.status(403).send('Không có quyền');
  }

  const result = await Investment.deleteMany({ userId: req.params.userId });

  await new Log({
    actor: u.username,
    action: 'Xóa toàn bộ gói đầu tư',
    targetUserId: req.params.userId,
    oldData: { investmentCount: result.deletedCount },
    newData: {},
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }).save();

  res.send(`Đã xóa ${result.deletedCount} gói đầu tư`);
});

// ✅ Cronjob cộng lãi (fix lỗi nhiều gói cùng user)
cron.schedule('0,30 * * * *', async () => {
  const now = new Date();
  const activeInvestments = await Investment.find({ status: 'active' });

  const profitMap = {};

  for (let inv of activeInvestments) {
    const diff = (now - inv.lastProfitAt) / (1000*60*60*24); // test 1 phút
    if (diff >= 1) {
      const profit = inv.amount * inv.profitRate;
      if (!profitMap[inv.userId]) profitMap[inv.userId] = 0;
      profitMap[inv.userId] += profit;

      inv.profitDays += 1;
      inv.lastProfitAt = now;

      if (inv.profitDays >= inv.days) {
        inv.status = 'finished';
        await User.updateOne({ userId: inv.userId }, { $inc: { investment: -inv.amount } });
      }

      await inv.save();

      await new Log({
        actor: 'Hệ thống',
        action: 'Cộng lãi gói ' + inv.package,
        targetUserId: inv.userId,
        newData: { profit },
        createdAt: now
      }).save();
    }
  }

  for (let userId in profitMap) {
    await User.updateOne({ userId }, { $inc: { balance: profitMap[userId] } });
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

  // 🎁 Cộng hoa hồng nếu user có cấp trên và admin đang cộng tiền
  if (diff > 0 && user.inviterId) {
    const inviter = await User.findOne({ userId: user.inviterId });
    if (inviter) {
      const commission = Math.round(diff * 0.1); // 10%
      inviter.balance += commission;
      await inviter.save();

      await new CommissionLog({
        fromUserId: user.userId,
        toUserId: inviter.userId,
        sourceAmount: diff,
        amount: commission
      }).save();

      await new Log({
        actor: 'Hệ thống',
        action: 'Cộng hoa hồng 10% từ cấp dưới',
        targetUserId: inviter.userId,
        newData: { hoaHong: commission },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }).save();
    }
  }
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

// ai đã mang hh cho mình :)))
app.get('/my/commission-log', requireLogin, async (req, res) => {
  const logs = await CommissionLog.find({ toUserId: req.session.user.userId }).sort({ timestamp: -1 });
  res.json(logs);
});

// route cho mời bb
app.get('/my/account', requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      userId: user.userId,
      inviterId: user.inviterId || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Không thể lấy thông tin người dùng' });
  }
});

// route nhập mã mời 
app.post('/my/set-inviter', requireLogin, async (req, res) => {
  const inviterId = req.body.inviterId?.trim();
  if (!inviterId) return res.status(400).json({ error: 'Thiếu mã người mời' });

  try {
    const user = await User.findById(req.user._id);

    if (user.inviterId) {
      return res.status(400).json({ error: 'Bạn đã nhập mã mời rồi' });
    }
    if (user.userId === inviterId) {
      return res.status(400).json({ error: 'Không thể mời chính mình' });
    }

    const inviter = await User.findOne({ userId: inviterId });
    if (!inviter) {
      return res.status(400).json({ error: 'Mã người mời không tồn tại' });
    }

    user.inviterId = inviterId;
    await user.save();

    // Lưu log mời bạn bè
    await new InviteLog({
      userId: user.userId,
      inviterId
    }).save();

    res.status(200).json({ message: 'Đã ghi nhận mã mời & lưu log' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi ghi nhận mã mời' });
  }
});

// route ds ng đã mời 
app.get('/my/referrals', requireLogin, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    const referrals = await User.find({ inviterId: currentUser.userId });

    res.json({
      referrals: referrals.map(u => ({
        username: u.username,
        createdAt: u.createdAt,
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Không thể tải danh sách người được mời' });
  }
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



