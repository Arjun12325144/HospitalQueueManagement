const express = require('express');
const jwt = require('jsonwebtoken');
// const JWT_SECRET = process.env.JWT_SECRET;
const { OAuth2Client } = require('google-auth-library');
const { db } = require('../lib/db');
const { User, Doctor, Appointment, Counter } = require('../lib/models');
const { nowIn, slotsFor } = require('../lib/time');
const lock = require('../lib/lock');
const pay = require('../lib/pay');
const mail = require('../lib/mail');

const E = process.env;
const app = express();
app.use(express.json({ verify: (q, s, b) => { q.rawBody = b.toString(); } })); // raw body is needed for the Razorpay webhook
const SERVICE_MIN = +E.SERVICE_MIN || 8, HOLD = 300, DATE = /^\d{4}-\d\d-\d\d$/, TIME = /^\d\d:\d\d$/;
const gclient = new OAuth2Client(E.GOOGLE_CLIENT_ID);
const bad = (s, m, c = 400) => s.status(c).json({ error: m });
const wrap = f => (q, s, n) => Promise.resolve(f(q, s, n)).catch(e => { console.error(e); bad(s, 'Server error. Please try again.', 500); });
const lk = (d, date, t) => `lock:${d}:${date}:${t}`;
const sortQ = a => a.sort((x, y) => y.priority - x.priority || x.slot.localeCompare(y.slot) || x.token - y.token);
const pending = (doctorId, date) => Appointment.find({ doctorId, date, status: { $in: ['booked', 'serving'] } });
const findDoc = id => Doctor.findById(id).catch(() => null);

const pubDoc = (d, full) => ({ id: d.id, name: d.name, department: d.department, fee: d.fee, ...(full ? { email: d.email, code: d.code, active: d.active, weekly: d.weekly, off: d.off } : {}) });
const pubAppt = a => ({ id: a.id, label: a.label, patientName: a.patientName, phone: a.phone, email: a.email, doctorName: a.doctorName, department: a.department, date: a.date, slot: a.slot, status: a.status, priority: a.priority, pay: { mode: a.payment.mode, status: a.payment.status, amount: a.payment.amount } });

// ---------- public ----------
app.get('/api/config', (q, s) => s.json({ googleClientId: E.GOOGLE_CLIENT_ID || '', payOnline: pay.enabled(), today: nowIn().date, serviceMin: SERVICE_MIN }));

app.use(async (q, s, n) => { try { await db(); n(); } catch (e) { console.error(e); bad(s, 'Database unavailable', 503); } });

// ---------- sessions ----------
const getCookie = (q, k) => (q.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(x => x[0] === k)?.[1];
const setSession = (s, tok, age) => s.setHeader('Set-Cookie', `cq=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${E.VERCEL ? '; Secure' : ''}`);
const admins = () => (E.ADMIN_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
const roleOf = async u => { const doctor = await Doctor.findOne({ email: u.email }); return { doctor, roles: ['patient', ...(admins().includes(u.email) ? ['admin'] : []), ...(doctor ? ['doctor'] : [])] }; };
const who = (u, roles) => ({ name: u.name, email: u.email, picture: u.picture, roles });

const auth = wrap(async (q, s, n) => {
  let uid;
  try { uid = jwt.verify(getCookie(q, 'cq') || '', E.JWT_SECRET).uid; } catch { return bad(s, 'Please sign in.', 401); }
  const u = await User.findById(uid);
  if (!u) return bad(s, 'Please sign in.', 401);
  q.user = u; Object.assign(q, await roleOf(u)); n();
});
const need = r => (q, s, n) => (q.roles.includes(r) ? n() : bad(s, 'You do not have access to this page.', 403));
const isDoc = [auth, need('doctor')], isAdmin = [auth, need('admin')];

app.post('/api/auth/google', wrap(async (q, s) => {
  let p;
  try { p = (await gclient.verifyIdToken({ idToken: q.body.credential, audience: E.GOOGLE_CLIENT_ID })).getPayload(); }
  catch { return bad(s, 'Google sign-in failed. Please try again.', 401); }
  if (!p.email_verified) return bad(s, 'Your Google email is not verified.', 401);
  const u = await User.findOneAndUpdate({ email: p.email.toLowerCase() }, { googleId: p.sub, name: p.name, picture: p.picture }, { upsert: true, new: true, setDefaultsOnInsert: true });
  setSession(s, jwt.sign({ uid: u.id }, E.JWT_SECRET, { expiresIn: '7d' }), 604800);
  s.json(who(u, (await roleOf(u)).roles));
}));
app.get('/api/auth/me', auth, (q, s) => s.json(who(q.user, q.roles)));
app.post('/api/auth/logout', (q, s) => { setSession(s, '', 0); s.json({ ok: true }); });

// ---------- doctors, slots, queue ----------
app.get('/api/doctors', wrap(async (q, s) => s.json({ doctors: (await Doctor.find({ active: true }).sort({ department: 1, name: 1 })).map(d => pubDoc(d)) })));

app.get('/api/slots', wrap(async (q, s) => {
  const { doctorId, date, holdId } = q.query, d = await findDoc(doctorId);
  if (!d || !d.active || !DATE.test(date)) return bad(s, 'Invalid request');
  const list = slotsFor(d, date);
  const taken = new Set((await Appointment.find({ doctorId: d._id, date, slotKey: { $exists: true } }, 'slot')).map(a => a.slot));
  const held = await lock.peek(list.map(t => lk(d.id, date, t)));
  s.json({ slots: list.map((time, i) => ({ time, state: taken.has(time) ? 'taken' : held[i] ? (held[i] === holdId ? 'mine' : 'held') : 'free' })) });
}));

app.post('/api/slots/hold', auth, wrap(async (q, s) => {
  const { doctorId, date, slot, holdId } = q.body, d = await findDoc(doctorId);
  if (!d || !d.active || !DATE.test(date) || !slotsFor(d, date).includes(slot) || !/^h_/.test(holdId || '')) return bad(s, 'That time is not available.');
  if (await Appointment.exists({ doctorId: d._id, date, slot, slotKey: { $exists: true } })) return bad(s, 'That slot was just booked.', 409);
  (await lock.acquire(lk(d.id, date, slot), holdId, HOLD)) ? s.json({ ok: true, ttl: HOLD }) : bad(s, 'Someone else is booking this slot. Try another time.', 409);
}));
app.post('/api/slots/release', auth, wrap(async (q, s) => { const { doctorId, date, slot, holdId } = q.body; await lock.release(lk(doctorId, date, slot), holdId); s.json({ ok: true }); }));

app.get('/api/queue', wrap(async (q, s) => {
  const { doctorId, date } = q.query;
  if (!DATE.test(date || '')) return bad(s, 'Invalid request');
  const list = sortQ(await pending(doctorId, date)), w = list.filter(x => x.status === 'booked');
  s.json({ serving: list.find(x => x.status === 'serving')?.label || null, count: w.length, waiting: w.slice(0, 8).map(x => ({ label: x.label })) });
}));

// ---------- booking ----------
// Shared checks for "pay at counter" and "pay online": valid doctor, slot, details, and you still hold the slot.
async function prep(q, s) {
  const { doctorId, date, slot, holdId, name, phone } = q.body, d = await findDoc(doctorId);
  if (!d || !d.active || !DATE.test(date) || !slotsFor(d, date).includes(slot)) { bad(s, 'That time is not available.'); return null; }
  if ((name || '').trim().length < 2 || !/^\d{10}$/.test(phone || '')) { bad(s, 'Enter your name and a 10-digit mobile number.'); return null; }
  const k = lk(d.id, date, slot);
  if (!(await lock.owns(k, holdId))) { bad(s, 'Your hold expired. Please pick the time again.', 409); return null; }
  return { d, date, slot, k, holdId, name: name.trim(), phone, senior: q.body.senior ? '1' : '' };
}
async function createAppt(d, u, v, payment) {
  const c = await Counter.findOneAndUpdate({ _id: d.id + '|' + v.date }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return Appointment.create({
    userId: u._id, patientName: v.name, phone: v.phone, email: u.email,
    doctorId: d._id, doctorName: d.name, department: d.department, date: v.date, slot: v.slot,
    slotKey: `${d.id}|${v.date}|${v.slot}`, token: c.seq, label: `${d.code}-${String(c.seq).padStart(3, '0')}`,
    priority: v.senior ? 1 : 0, payment,
  });
}

app.post('/api/appointments', auth, wrap(async (q, s) => { // pay at counter
  const v = await prep(q, s); if (!v) return;
  let a;
  try { a = await createAppt(v.d, q.user, v, { mode: 'counter', status: v.d.fee ? 'pending' : 'paid', amount: v.d.fee }); }
  catch (e) { if (e.code === 11000) return bad(s, 'That slot was just booked. Pick another.', 409); throw e; }
  await lock.release(v.k, v.holdId); await mail.booked(a);
  s.json({ id: a.id, label: a.label });
}));

app.post('/api/payments/order', auth, wrap(async (q, s) => {
  if (!pay.enabled()) return bad(s, 'Online payment is not set up. Please choose pay at counter.');
  const v = await prep(q, s); if (!v) return;
  if (!v.d.fee) return bad(s, 'This doctor has no fee. Please choose pay at counter.');
  await lock.acquire(v.k, v.holdId, 600); // keep the slot while the payment window is open
  const o = await pay.createOrder(v.d.fee * 100, 'cq_' + Date.now(), { uid: String(q.user._id), doctorId: String(v.d._id), date: v.date, slot: v.slot, name: v.name, phone: v.phone, senior: v.senior, holdId: v.holdId });
  s.json({ orderId: o.id, amount: o.amount, keyId: E.RAZORPAY_KEY_ID });
}));

// Turns a paid order into an appointment. Used by both the browser callback and the webhook, so it is safe to run twice.
async function finalize(orderId, paymentId) {
  const have = await Appointment.findOne({ 'payment.orderId': orderId });
  if (have) return { a: have };
  const o = await pay.getOrder(orderId), n = o.notes;
  const d = await findDoc(n.doctorId), u = await User.findById(n.uid);
  if (!d || !u) throw new Error('Order refers to a missing doctor or user');
  let a;
  try { a = await createAppt(d, u, { date: n.date, slot: n.slot, name: n.name, phone: n.phone, senior: n.senior }, { mode: 'online', status: 'paid', amount: o.amount / 100, orderId, paymentId, paidAt: new Date() }); }
  catch (e) {
    if (e.code !== 11000) throw e;
    const again = await Appointment.findOne({ 'payment.orderId': orderId });
    if (again) return { a: again };
    await pay.refund(paymentId); // someone else got the slot while this person was paying
    return { refunded: true };
  }
  await lock.release(lk(d.id, n.date, n.slot), n.holdId); await mail.booked(a);
  return { a };
}

app.post('/api/payments/verify', auth, wrap(async (q, s) => {
  const { orderId, paymentId, signature } = q.body;
  if (!pay.enabled() || !pay.verifySig(orderId, paymentId, signature)) return bad(s, 'Payment could not be verified.');
  const r = await finalize(orderId, paymentId);
  if (r.refunded) return bad(s, 'This slot was taken while you were paying. Your money will be refunded in 5 to 7 days.', 409);
  if (String(r.a.userId) !== String(q.user._id)) return bad(s, 'Not allowed.', 403);
  s.json({ id: r.a.id, label: r.a.label });
}));

app.post('/api/payments/webhook', wrap(async (q, s) => { // safety net if the browser closes right after paying
  if (!E.RAZORPAY_WEBHOOK_SECRET || !pay.verifyWebhook(q.rawBody, q.headers['x-razorpay-signature'])) return s.status(400).end();
  if (q.body.event === 'payment.captured') { const p = q.body.payload.payment.entity; await finalize(p.order_id, p.id); }
  s.json({ ok: true });
}));

app.get('/api/my/appointments', auth, wrap(async (q, s) => {
  const today = nowIn().date, qc = {}, out = [];
  for (const a of await Appointment.find({ userId: q.user._id }).sort({ date: -1, slot: -1 }).limit(20)) {
    let ahead = null, serving = null;
    if (a.date === today && ['booked', 'serving'].includes(a.status)) {
      const k = String(a.doctorId); qc[k] = qc[k] || sortQ(await pending(a.doctorId, a.date));
      ahead = a.status === 'serving' ? -1 : qc[k].filter(x => x.status === 'booked').findIndex(x => x.id === a.id);
      serving = qc[k].find(x => x.status === 'serving')?.label || null;
    }
    out.push({ ...pubAppt(a), ahead, serving, etaMin: ahead > 0 ? ahead * SERVICE_MIN : 0 });
  }
  s.json({ appointments: out });
}));

// ---------- doctor ----------
app.get('/api/doctor/me', ...isDoc, (q, s) => s.json({ doctor: pubDoc(q.doctor, true) }));

app.put('/api/doctor/availability', ...isDoc, wrap(async (q, s) => {
  const { weekly, off } = q.body;
  if (!Array.isArray(weekly) || weekly.length !== 7 || !weekly.every(w => TIME.test(w.start) && TIME.test(w.end) && (!w.on || w.start < w.end))) return bad(s, 'Check your times. Start must be before end.');
  if (!Array.isArray(off) || !off.every(x => DATE.test(x))) return bad(s, 'Invalid days off.');
  q.doctor.weekly = weekly.map(w => ({ on: !!w.on, start: w.start, end: w.end }));
  q.doctor.off = [...new Set(off)].sort();
  await q.doctor.save();
  s.json({ ok: true });
}));

app.get('/api/doctor/appointments', ...isDoc, wrap(async (q, s) => {
  const l = await Appointment.find({ doctorId: q.doctor._id, date: { $gte: nowIn().date }, status: { $ne: 'cancelled' } }).sort({ date: 1, slot: 1 }).limit(300);
  s.json({ appointments: l.map(pubAppt) });
}));

app.post('/api/doctor/next', ...isDoc, wrap(async (q, s) => { // call the next patient in today's queue
  const doctorId = q.doctor._id, date = nowIn().date;
  await Appointment.updateMany({ doctorId, date, status: 'serving' }, { status: q.body.skip ? 'noshow' : 'done', doneAt: new Date() });
  const n = sortQ(await Appointment.find({ doctorId, date, status: 'booked' }))[0];
  if (n) { n.status = 'serving'; n.calledAt = new Date(); await n.save(); }
  s.json({ serving: n?.label || null });
}));

// ---------- admin ----------
app.get('/api/admin/appointments', ...isAdmin, wrap(async (q, s) => {
  const f = DATE.test(q.query.date || '') ? { date: q.query.date } : {};
  s.json({ appointments: (await Appointment.find(f).sort({ date: -1, slot: 1 }).limit(300)).map(pubAppt) });
}));

app.patch('/api/admin/appointments/:id', ...isAdmin, wrap(async (q, s) => {
  const a = await Appointment.findById(q.params.id).catch(() => null);
  if (!a) return bad(s, 'Appointment not found.', 404);
  if (q.body.action === 'paid') {
    if (a.payment.status === 'paid') return bad(s, 'Already marked as paid.');
    a.payment.status = 'paid'; a.payment.paidAt = new Date();
  } else if (q.body.action === 'cancel') { a.status = 'cancelled'; a.slotKey = undefined; }
  else return bad(s, 'Unknown action.');
  await a.save(); s.json(pubAppt(a));
}));

app.get('/api/admin/doctors', ...isAdmin, wrap(async (q, s) => s.json({ doctors: (await Doctor.find().sort({ department: 1, name: 1 })).map(d => pubDoc(d, true)) })));

app.post('/api/admin/doctors', ...isAdmin, wrap(async (q, s) => {
  const { name, email, department } = q.body, fee = Math.round(+q.body.fee || 0);
  if ((name || '').trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email || '') || (department || '').trim().length < 2 || fee < 0 || fee > 100000) return bad(s, 'Enter a name, a Google email, a department and a fee between 0 and 100000.');
  const base = (name.replace(/dr\.?/i, '').replace(/[^a-z]/gi, '').slice(0, 3) || 'DOC').toUpperCase();
  let code = base, i = 1; while (await Doctor.exists({ code })) code = base + ++i;
  try { s.json(pubDoc(await Doctor.create({ name: name.trim(), email, department: department.trim(), fee, code }), true)); }
  catch (e) { if (e.code === 11000) return bad(s, 'A doctor with this email already exists.', 409); throw e; }
}));

app.patch('/api/admin/doctors/:id', ...isAdmin, wrap(async (q, s) => {
  const d = await findDoc(q.params.id); if (!d) return bad(s, 'Doctor not found.', 404);
  const { active, fee, department, name } = q.body;
  if (typeof active === 'boolean') d.active = active;
  if (fee !== undefined && +fee >= 0 && +fee <= 100000) d.fee = Math.round(+fee);
  if (department) d.department = String(department).trim();
  if (name) d.name = String(name).trim();
  await d.save(); s.json(pubDoc(d, true));
}));

module.exports = app;
