// Razorpay over plain REST (no SDK needed).
const crypto = require('crypto');
const E = process.env;
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function rz(path, method = 'GET', body) {
  const r = await fetch('https://api.razorpay.com/v1' + path, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(E.RAZORPAY_KEY_ID + ':' + E.RAZORPAY_KEY_SECRET).toString('base64'), 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.description || 'Razorpay error');
  return d;
}
exports.enabled = () => !!(E.RAZORPAY_KEY_ID && E.RAZORPAY_KEY_SECRET);
exports.createOrder = (paise, receipt, notes) => rz('/orders', 'POST', { amount: paise, currency: 'INR', receipt, notes });
exports.getOrder = id => rz('/orders/' + id);
exports.refund = paymentId => rz(`/payments/${paymentId}/refund`, 'POST', {});
exports.verifySig = (orderId, paymentId, sig) => eq(crypto.createHmac('sha256', E.RAZORPAY_KEY_SECRET).update(orderId + '|' + paymentId).digest('hex'), String(sig || ''));
exports.verifyWebhook = (raw, sig) => eq(crypto.createHmac('sha256', E.RAZORPAY_WEBHOOK_SECRET).update(raw || '').digest('hex'), String(sig || ''));
