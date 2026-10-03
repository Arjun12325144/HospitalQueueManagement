const pad = n => String(n).padStart(2, '0');
// Current date and time in the hospital's timezone.
exports.nowIn = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_NAME || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
};
// Bookable 30 minute slots for a doctor on a date (past times and days off are removed).
exports.slotsFor = (d, date) => {
  const n = exports.nowIn();
  if (date < n.date || d.off.includes(date)) return [];
  const w = d.weekly[new Date(date + 'T00:00:00Z').getUTCDay()];
  if (!w || !w.on) return [];
  const [sh, sm] = w.start.split(':').map(Number), [eh, em] = w.end.split(':').map(Number), out = [];
  for (let t = sh * 60 + sm; t < eh * 60 + em; t += 30) {
    const x = pad(Math.floor(t / 60)) + ':' + pad(t % 60);
    if (date > n.date || x > n.time) out.push(x);
  }
  return out;
};
