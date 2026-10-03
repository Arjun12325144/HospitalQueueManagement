const nodemailer = require('nodemailer');
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;

async function sms(phone, body) {
  const { TWILIO_SID: sid, TWILIO_TOKEN: tok, TWILIO_FROM: from } = process.env;
  if (!sid) return console.log('[sms dev]', phone, body);
  const to = (process.env.COUNTRY_CODE || '+91') + phone;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error('Twilio ' + res.status);
}
async function mail(to, text) {
  if (!mailer) return console.log('[mail dev]', to, text);
  await mailer.sendMail({ from: process.env.MAIL_FROM, to, subject: 'CareQueue update', text });
}
// Awaited by callers: serverless functions freeze once the response is sent.
exports.send = async (a, text) => {
  const jobs = [];
  if (a.notify?.sms) jobs.push(sms(a.phone, text));
  if (a.notify?.mail && a.email) jobs.push(mail(a.email, text));
  (await Promise.allSettled(jobs)).forEach(x => x.status === 'rejected' && console.error(x.reason));
};
