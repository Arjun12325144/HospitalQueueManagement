import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api';
import './styles.css';

const scripts = {};
const loadScript = src => scripts[src] || (scripts[src] = new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = () => no(new Error('Could not load ' + src)); document.body.appendChild(s); }));
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayLabel = (d, today) => d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : new Date(d + 'T00:00:00Z').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const t12 = t => { let [h, m] = t.split(':'); h = +h; return `${h > 12 ? h - 12 : h}:${m} ${h >= 12 ? 'PM' : 'AM'}`; };
const qs = o => '?' + new URLSearchParams(o);
const STATUS = { booked: 'Booked', serving: 'In room', done: 'Completed', noshow: 'Missed', cancelled: 'Cancelled' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function usePoll(fn, ms, deps) {
  useEffect(() => { let on = true; const run = () => on && fn(); run(); const i = setInterval(run, ms); return () => { on = false; clearInterval(i); }; }, deps);
}
const PayTag = ({ a }) => <span className={'tag' + (a.pay.status === 'paid' ? '' : ' warn')}>{a.pay.status === 'paid' ? `Paid ${a.pay.mode === 'online' ? 'online' : 'at counter'}` : 'Pay at counter'} · ₹{a.pay.amount}</span>;
const StatusTag = ({ a }) => <span className={'tag' + (a.status === 'serving' ? ' now' : a.status === 'cancelled' || a.status === 'noshow' ? ' no' : '')}>{STATUS[a.status]}</span>;
const SubTabs = ({ tabs, cur, set }) => <div className="subtabs">{tabs.map(([k, l]) => <button key={k} className={'chip' + (cur === k ? ' on' : '')} onClick={() => set(k)}>{l}</button>)}</div>;

function GoogleBtn({ cfg, onLogin, toast }) {
  const ref = useRef();
  useEffect(() => {
    if (!cfg.googleClientId) return;
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: async r => { try { onLogin(await api('/auth/google', { method: 'POST', body: { credential: r.credential } })); } catch (e) { toast(e.message); } } });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
    }).catch(e => toast(e.message));
  }, [cfg]);
  return cfg.googleClientId ? <div ref={ref} /> : <p className="sub">Google sign-in is not set up yet (GOOGLE_CLIENT_ID is missing).</p>;
}
const SignIn = props => <div className="card" style={{ maxWidth: 440, margin: '30px auto', textAlign: 'center' }}><h2>Sign in to continue</h2><p className="sub">Use your Google account. We only read your name and email.</p><div style={{ display: 'flex', justifyContent: 'center' }}><GoogleBtn {...props} /></div></div>;

function Home({ cfg, me, go, ...p }) {
  return (<>
    <div className="hero">
      <div>
        <h1>Know your turn before you leave home.</h1>
        <p>Sign in with Google, pick a doctor and a time, pay online or at the counter, and watch the line move from your phone.</p>
        {me ? <><button className="btn" onClick={() => go('book')}>Book a slot</button><button className="btn ghost" onClick={() => go('visits')}>My visits</button></> : <GoogleBtn cfg={cfg} {...p} />}
      </div>
      <div className="board">
        <small>{me ? 'Signed in as ' + me.name : 'Live queue'}</small>
        <div className="now"><span className="pulse" /><b>{me ? 'Hello' : 'A-001'}</b></div>
        <div className="mini"><div><strong>30 min</strong><small>slot length</small></div><div><strong>₹0 wait</strong><small>standing in line</small></div></div>
      </div>
    </div>
    <div className="grid three">
      <div className="card"><h3>Held for you</h3><p className="sub" style={{ margin: '8px 0 0' }}>Your slot is reserved while you fill the form and pay, so nobody else can take it.</p></div>
      <div className="card"><h3>Pay your way</h3><p className="sub" style={{ margin: '8px 0 0' }}>Pay online with UPI or card, or choose to pay at the hospital counter.</p></div>
      <div className="card"><h3>Email confirmation</h3><p className="sub" style={{ margin: '8px 0 0' }}>You get an email with your token, doctor, time and payment status.</p></div>
    </div>
  </>);
}

function Book({ cfg, me, toast, onDone }) {
  const [docs, setDocs] = useState(null), [dep, setDep] = useState(''), [doc, setDoc] = useState(null), [day, setDay] = useState(0);
  const [slots, setSlots] = useState([]), [slot, setSlot] = useState(null), [left, setLeft] = useState(0), [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: me.name || '', phone: '', senior: false }), [mode, setMode] = useState(cfg.payOnline ? 'online' : 'counter');
  const holdId = useRef('h_' + crypto.randomUUID().replace(/-/g, '')).current, held = useRef(null);
  const date = addDays(cfg.today, day);

  useEffect(() => { api('/doctors').then(d => { setDocs(d.doctors); if (d.doctors[0]) { setDep(d.doctors[0].department); setDoc(d.doctors[0]); } }).catch(e => toast(e.message)); }, []);
  const load = useCallback(() => doc ? api('/slots' + qs({ doctorId: doc.id, date, holdId })).then(d => setSlots(d.slots)).catch(e => toast(e.message)) : null, [doc, date]);
  usePoll(load, 6000, [load]);
  const drop = () => { if (held.current) api('/slots/release', { method: 'POST', body: { ...held.current, holdId } }).catch(() => {}); held.current = null; setSlot(null); };
  useEffect(() => { drop(); }, [doc, date]);
  useEffect(() => {
    if (!slot) return;
    setLeft(300);
    const i = setInterval(() => setLeft(l => { if (l <= 1) { clearInterval(i); held.current = null; setSlot(null); toast('Hold expired. Pick a time again.'); return 0; } return l - 1; }), 1000);
    return () => clearInterval(i);
  }, [slot]);

  async function pick(t) {
    try {
      const prev = held.current;
      await api('/slots/hold', { method: 'POST', body: { doctorId: doc.id, date, slot: t, holdId } });
      if (prev && prev.slot !== t) api('/slots/release', { method: 'POST', body: { ...prev, holdId } }).catch(() => {});
      held.current = { doctorId: doc.id, date, slot: t }; setSlot(t);
    } catch (e) { toast(e.message); }
    load();
  }
  async function payOnline(body) {
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    const o = await api('/payments/order', { method: 'POST', body });
    return new Promise((res, rej) => {
      let paid = false;
      const rz = new window.Razorpay({
        key: o.keyId, order_id: o.orderId, amount: o.amount, currency: 'INR', name: 'CareQueue', description: `${doc.name} · ${date} ${slot}`,
        prefill: { name: f.name, email: me.email, contact: f.phone }, theme: { color: '#1b6b58' },
        handler: async r => { paid = true; try { res(await api('/payments/verify', { method: 'POST', body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } })); } catch (e) { rej(e); } },
        modal: { ondismiss: () => { if (!paid) rej(new Error('Payment cancelled. Your slot is still held for a few minutes.')); } },
      });
      rz.on('payment.failed', r => toast(r.error?.description || 'Payment failed. You can try again.'));
      rz.open();
    });
  }
  async function confirm() {
    setBusy(true);
    const body = { doctorId: doc.id, date, slot, holdId, name: f.name, phone: f.phone, senior: f.senior };
    try {
      const r = mode === 'online' ? await payOnline(body) : await api('/appointments', { method: 'POST', body });
      held.current = null; toast('Booked. Your token is ' + r.label + '. Check your email.'); onDone();
    } catch (e) { toast(e.message); load(); }
    setBusy(false);
  }
  const chips = (list, cur, fn, label) => <div className="chips">{list.map((v, i) => <button key={i} className={'chip' + (cur(v) ? ' on' : '')} onClick={() => fn(v)}>{label(v)}</button>)}</div>;

  if (!docs) return <div className="empty">Loading doctors…</div>;
  if (!docs.length) return <div className="card empty"><h3 style={{ marginBottom: 8 }}>No doctors yet</h3>The admin needs to add doctors first (Admin, then Doctors).</div>;
  const depts = [...new Set(docs.map(d => d.department))];
  return (
    <div className="grid">
      <div className="card">
        <h2>Book an appointment</h2><p className="sub">Choose a doctor and a time.</p>
        <label className="t">Department</label>{chips(depts, v => v === dep, v => { setDep(v); setDoc(docs.find(d => d.department === v)); }, v => v)}
        <label className="t">Doctor</label>{chips(docs.filter(d => d.department === dep), v => v.id === doc?.id, setDoc, v => `${v.name} · ₹${v.fee}`)}
        <label className="t">Day</label>{chips([0, 1, 2, 3, 4, 5, 6], v => v === day, setDay, v => dayLabel(addDays(cfg.today, v), cfg.today))}
        <label className="t">Time</label>
        {slots.length ? <div className="slots">{slots.map(s => <button key={s.time} className={'slot' + (slot === s.time ? ' mine' : '')} disabled={s.state === 'taken' || s.state === 'held'} title={s.state === 'taken' ? 'Already booked' : s.state === 'held' ? 'Someone is booking this' : 'Available'} onClick={() => pick(s.time)}>{t12(s.time)}</button>)}</div> : <p className="sub">No slots on this day. Try another day.</p>}
        {slot && <div className="hold">We're holding {t12(slot)} for you for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>}
      </div>
      <div className="card">
        <h3 style={{ fontSize: 22 }}>Your details</h3>
        <label className="t" htmlFor="nm">Patient name</label><input id="nm" type="text" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <label className="t" htmlFor="ph">Mobile number</label><input id="ph" type="tel" inputMode="numeric" maxLength={10} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="10-digit number" />
        <label className="sw" style={{ marginTop: 14 }}><input type="checkbox" checked={f.senior} onChange={e => setF({ ...f, senior: e.target.checked })} /> Patient is 60 or older</label>
        <label className="t">Payment</label>
        <div className="opts">
          <div className={'opt' + (mode === 'online' ? ' on' : '') + (cfg.payOnline ? '' : ' off')} onClick={() => cfg.payOnline && setMode('online')}><input type="radio" readOnly checked={mode === 'online'} /><span><b>Pay now · ₹{doc?.fee}</b>UPI, card or net banking{cfg.payOnline ? '' : ' (not set up)'}</span></div>
          <div className={'opt' + (mode === 'counter' ? ' on' : '')} onClick={() => setMode('counter')}><input type="radio" readOnly checked={mode === 'counter'} /><span><b>Pay at hospital counter</b>Pay ₹{doc?.fee} when you arrive</span></div>
        </div>
        <p className="sub" style={{ margin: '16px 0 12px' }}>{slot ? `${doc.name} · ${dayLabel(date, cfg.today)} at ${t12(slot)}` : 'Choose a time slot to continue.'}</p>
        <button className="btn" style={{ width: '100%' }} disabled={!slot || busy} onClick={confirm}>{busy ? 'Please wait…' : mode === 'online' ? `Pay ₹${doc?.fee} and book` : 'Confirm booking'}</button>
      </div>
    </div>
  );
}

function Visits({ go }) {
  const [l, setL] = useState(null);
  usePoll(() => api('/my/appointments').then(d => setL(d.appointments)).catch(() => {}), 5000, []);
  if (!l) return <div className="empty">Loading…</div>;
  if (!l.length) return <div className="card empty"><h3 style={{ marginBottom: 8 }}>No appointments yet</h3>Book a slot and it shows up here.<br /><br /><button className="btn" onClick={() => go('book')}>Book a slot</button></div>;
  return <div className="list">{l.map(a => {
    const live = a.ahead !== null;
    const msg = a.status === 'serving' ? "It's your turn. Please go to the doctor's room." : a.ahead === 0 ? "You're next. Stay close to the room." : `${a.ahead} ahead of you · about ${a.etaMin} min`;
    return (<div className="card" key={a.id}>
      <div className="item">
        <div><div className="big">{a.label}</div><div>{a.doctorName} · {a.department}</div><small className="sub">{a.date} at {t12(a.slot)}</small></div>
        <div style={{ textAlign: 'right' }}><PayTag a={a} /><div style={{ marginTop: 6 }}><StatusTag a={a} /></div></div>
      </div>
      {live && <><div className="bar"><i style={{ width: (a.ahead <= 0 ? 100 : Math.max(8, 100 - a.ahead * 12)) + '%' }} /></div><p style={{ margin: 0, fontWeight: 600 }}>{msg}{a.serving ? ` · Now serving ${a.serving}` : ''}</p></>}
    </div>);
  })}</div>;
}

function Upcoming({ today, toast }) {
  const [l, setL] = useState(null);
  const load = useCallback(() => api('/doctor/appointments').then(d => setL(d.appointments)).catch(e => toast(e.message)), []);
  usePoll(load, 8000, [load]);
  const act = skip => api('/doctor/next', { method: 'POST', body: { skip } }).then(r => { toast(r.serving ? 'Called ' + r.serving : 'No one is waiting'); load(); }).catch(e => toast(e.message));
  if (!l) return <div className="empty">Loading…</div>;
  const cur = l.find(a => a.date === today && a.status === 'serving'), waiting = l.filter(a => a.date === today && a.status === 'booked').length;
  return (<>
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 20 }}>Today's queue</h3>
      <p>{cur ? `In room: ${cur.label} · ${cur.patientName}` : 'Nobody in the room'} · {waiting} waiting</p>
      <div className="acts"><button className="btn" onClick={() => act(false)}>Call next patient</button><button className="btn ghost" style={{ margin: 0 }} onClick={() => act(true)}>Skip current (did not show)</button></div>
    </div>
    {!l.length && <div className="card empty">No upcoming appointments.</div>}
    {[...new Set(l.map(a => a.date))].map(d => <div key={d} style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 18, margin: '0 0 8px' }}>{dayLabel(d, today)}</h3>
      <div className="list">{l.filter(a => a.date === d).map(a => <div className="card item" key={a.id}>
        <div><b>{t12(a.slot)}</b> · {a.label}{a.priority ? ' · senior' : ''}<div>{a.patientName} · {a.phone}</div></div>
        <div style={{ textAlign: 'right' }}><PayTag a={a} /><div style={{ marginTop: 6 }}><StatusTag a={a} /></div></div>
      </div>)}</div>
    </div>)}
  </>);
}

function Availability({ today, toast }) {
  const [w, setW] = useState(null), [off, setOff] = useState([]), [nd, setNd] = useState('');
  useEffect(() => { api('/doctor/me').then(d => { setW(d.doctor.weekly); setOff(d.doctor.off); }).catch(e => toast(e.message)); }, []);
  if (!w) return <div className="empty">Loading…</div>;
  const upd = (i, k, v) => setW(w.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const save = () => api('/doctor/availability', { method: 'PUT', body: { weekly: w, off } }).then(() => toast('Availability saved')).catch(e => toast(e.message));
  return (<>
    <div className="grid">
      <div className="card"><h3 style={{ fontSize: 20 }}>Weekly hours</h3><p className="sub" style={{ margin: '6px 0 0' }}>Patients can book 30 minute slots inside these hours.</p>
        <div className="days">{w.map((x, i) => <div className="day" key={i}>
          <label className="sw"><input type="checkbox" checked={x.on} onChange={e => upd(i, 'on', e.target.checked)} />{DAYS[i]}</label>
          {x.on ? <div className="row" style={{ gap: 8 }}><input type="time" value={x.start} onChange={e => upd(i, 'start', e.target.value)} /><input type="time" value={x.end} onChange={e => upd(i, 'end', e.target.value)} /></div> : <span className="sub" style={{ margin: 0 }}>Not working</span>}
        </div>)}</div></div>
      <div className="card"><h3 style={{ fontSize: 20 }}>Days off</h3><p className="sub" style={{ margin: '6px 0 12px' }}>Existing bookings are not cancelled automatically.</p>
        <div className="row" style={{ gap: 8 }}><input type="date" min={today} value={nd} onChange={e => setNd(e.target.value)} /><button className="mini-btn" onClick={() => { if (nd && !off.includes(nd)) setOff([...off, nd].sort()); setNd(''); }}>Add</button></div>
        <div className="chips" style={{ marginTop: 14 }}>{off.length ? off.map(d => <button key={d} className="chip" title="Remove" onClick={() => setOff(off.filter(x => x !== d))}>{dayLabel(d, today)} ✕</button>) : <span className="sub" style={{ margin: 0 }}>No days off added.</span>}</div></div>
    </div>
    <button className="btn" style={{ marginTop: 18 }} onClick={save}>Save availability</button>
  </>);
}
function Doctor({ today, toast }) {
  const [tab, setTab] = useState('up');
  return <><h2>Doctor dashboard</h2><SubTabs tabs={[['up', 'Upcoming'], ['av', 'Availability']]} cur={tab} set={setTab} />{tab === 'up' ? <Upcoming today={today} toast={toast} /> : <Availability today={today} toast={toast} />}</>;
}

function AdminApps({ today, toast }) {
  const [date, setDate] = useState(today), [pf, setPf] = useState('all'), [l, setL] = useState(null);
  const load = useCallback(() => api('/admin/appointments' + qs(date ? { date } : {})).then(d => setL(d.appointments)).catch(e => toast(e.message)), [date]);
  usePoll(load, 10000, [load]);
  const act = (id, action) => {
    if (action === 'cancel' && !window.confirm('Cancel this appointment? If it was paid online, refund it from the Razorpay dashboard.')) return;
    api('/admin/appointments/' + id, { method: 'PATCH', body: { action } }).then(load).catch(e => toast(e.message));
  };
  const live = (l || []).filter(a => a.status !== 'cancelled'), paid = live.filter(a => a.pay.status === 'paid');
  const shown = (l || []).filter(a => pf === 'all' || (a.status !== 'cancelled' && (pf === 'paid') === (a.pay.status === 'paid')));
  return (<>
    <div className="stats">
      <div className="card stat"><strong>{live.length}</strong><span>Appointments</span></div>
      <div className="card stat"><strong>{paid.length}</strong><span>Paid</span></div>
      <div className="card stat"><strong>{live.length - paid.length}</strong><span>Not paid yet</span></div>
      <div className="card stat"><strong>₹{paid.reduce((n, a) => n + a.pay.amount, 0)}</strong><span>Collected</span></div>
    </div>
    <div className="filters">
      <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" />
      <select value={pf} onChange={e => setPf(e.target.value)} aria-label="Payment filter"><option value="all">All payments</option><option value="paid">Paid</option><option value="unpaid">Not paid</option></select>
      <button className="mini-btn" onClick={() => setDate('')}>All dates</button>
    </div>
    {!l ? <div className="empty">Loading…</div> : !shown.length ? <div className="card empty">No appointments found.</div> :
      <div className="list">{shown.map(a => <div className="card item" key={a.id}>
        <div><b>{a.label}</b> · {a.date} {t12(a.slot)}<div>{a.patientName} · {a.phone}</div><small className="sub">{a.email} · {a.doctorName}, {a.department}</small></div>
        <div style={{ textAlign: 'right' }}><PayTag a={a} /> <StatusTag a={a} />
          {a.status !== 'cancelled' && <div className="acts" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            {a.pay.status !== 'paid' && <button className="mini-btn" onClick={() => act(a.id, 'paid')}>Mark paid</button>}
            {['booked', 'serving'].includes(a.status) && <button className="mini-btn danger" onClick={() => act(a.id, 'cancel')}>Cancel</button>}
          </div>}</div>
      </div>)}</div>}
  </>);
}
function AdminDocs({ toast }) {
  const [l, setL] = useState(null), [f, setF] = useState({ name: '', email: '', department: '', fee: '' });
  const load = useCallback(() => api('/admin/doctors').then(d => setL(d.doctors)).catch(e => toast(e.message)), []);
  useEffect(() => { load(); }, []);
  const add = () => api('/admin/doctors', { method: 'POST', body: f }).then(() => { setF({ name: '', email: '', department: '', fee: '' }); toast('Doctor added'); load(); }).catch(e => toast(e.message));
  const patch = (id, body) => api('/admin/doctors/' + id, { method: 'PATCH', body }).then(load).catch(e => toast(e.message));
  const inp = (k, label, type = 'text') => <div><label>{label}</label><input type={type} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>;
  return (<>
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 20, marginBottom: 4 }}>Add a doctor</h3><p className="sub" style={{ marginBottom: 14 }}>The doctor signs in with the Google account that matches this email.</p>
      <div className="form">{inp('name', 'Name')}{inp('email', 'Google email', 'email')}{inp('department', 'Department')}{inp('fee', 'Fee (₹)', 'number')}<button className="btn" onClick={add}>Add</button></div>
    </div>
    {!l ? <div className="empty">Loading…</div> : <div className="list">{l.map(d => <div className="card item" key={d.id}>
      <div><b>{d.name}</b> · {d.department} · code {d.code}<div className="sub" style={{ margin: 0 }}>{d.email} · ₹{d.fee}</div></div>
      <div className="acts"><span className={'tag' + (d.active ? '' : ' no')}>{d.active ? 'Active' : 'Hidden'}</span>
        <button className="mini-btn" onClick={() => { const v = window.prompt('New fee in rupees', d.fee); if (v !== null) patch(d.id, { fee: v }); }}>Change fee</button>
        <button className="mini-btn" onClick={() => patch(d.id, { active: !d.active })}>{d.active ? 'Hide' : 'Show'}</button></div>
    </div>)}</div>}
  </>);
}
function Admin({ today, toast }) {
  const [tab, setTab] = useState('apps');
  return <><h2>Admin</h2><SubTabs tabs={[['apps', 'Appointments and payments'], ['docs', 'Doctors']]} cur={tab} set={setTab} />{tab === 'apps' ? <AdminApps today={today} toast={toast} /> : <AdminDocs toast={toast} />}</>;
}

export default function App() {
  const [tab, setTab] = useState('home'), [cfg, setCfg] = useState(null), [me, setMe] = useState(undefined), [msg, setMsg] = useState('');
  const toast = useCallback(m => { setMsg(m); clearTimeout(toast.h); toast.h = setTimeout(() => setMsg(''), 3500); }, []);
  useEffect(() => {
    api('/config').then(setCfg).catch(() => toast('Cannot reach the server. Check your setup.'));
    api('/auth/me').then(setMe).catch(() => setMe(null));
  }, []);
  const go = t => { setTab(t); scrollTo({ top: 0 }); };
  const login = u => { setMe(u); go('book'); };
  const logout = () => api('/auth/logout', { method: 'POST' }).then(() => { setMe(null); go('home'); });
  const roles = me?.roles || [];
  const tabs = [['home', 'Home'], ['book', 'Book'], ...(me ? [['visits', 'My visits']] : []), ...(roles.includes('doctor') ? [['doctor', 'Doctor']] : []), ...(roles.includes('admin') ? [['admin', 'Admin']] : [])];
  const gate = { cfg, onLogin: login, toast };
  let page = <div className="empty">Loading…</div>;
  if (cfg && me !== undefined) {
    if (tab === 'home') page = <Home cfg={cfg} me={me} go={go} onLogin={login} toast={toast} />;
    else if (!me) page = <SignIn {...gate} />;
    else if (tab === 'book') page = <Book cfg={cfg} me={me} toast={toast} onDone={() => go('visits')} />;
    else if (tab === 'visits') page = <Visits go={go} />;
    else if (tab === 'doctor' && roles.includes('doctor')) page = <Doctor today={cfg.today} toast={toast} />;
    else if (tab === 'admin' && roles.includes('admin')) page = <Admin today={cfg.today} toast={toast} />;
    else page = <div className="card empty">You do not have access to this page.</div>;
  }
  return (<>
    <header><div className="wrap">
      <div className="logo"><i>+</i><span>CareQueue</span></div>
      <div className="hd-right">{me && <><img className="av" src={me.picture} alt="" referrerPolicy="no-referrer" /><button className="so" onClick={logout}>Sign out</button></>}</div>
      <nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}</nav>
    </div></header>
    <main className="wrap"><section className="pane" key={tab}>{page}</section></main>
    <div className={'toast' + (msg ? ' show' : '')} role="status">{msg}</div>
  </>);
}
