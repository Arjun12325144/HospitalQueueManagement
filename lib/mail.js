// Email only (free). Works with Gmail App Password or Brevo SMTP.
const nodemailer = require('nodemailer');
const E = process.env;
const t = E.SMTP_HOST ? nodemailer.createTransport({ host: E.SMTP_HOST, port: +E.SMTP_PORT || 587, secure: +E.SMTP_PORT === 465, auth: { user: E.SMTP_USER, pass: E.SMTP_PASS } }) : null;

exports.booked = async a => {
  if (!a.email) return;
  const name = E.HOSPITAL_NAME || 'CareQueue';
  const paid = a.payment.status === 'paid';
  const text = `Hello ${a.patientName},

Your appointment is confirmed.

Doctor:   ${a.doctorName} (${a.department})
Date:     ${a.date}
Time:     ${a.slot}
Token:    ${a.label}
Payment:  ${paid ? `Paid Rs ${a.payment.amount} online` : `Rs ${a.payment.amount} to be paid at the hospital counter`}

Please arrive 10 minutes early and show your token at the desk.
You can track your turn by signing in with Google on our website.

${name}`;
  try {
    if (!t) return console.log('[mail dev]', a.email, '\n' + text);
    await t.sendMail({ from: E.MAIL_FROM, to: a.email, subject: `Appointment confirmed: ${a.label} on ${a.date}`, text });
  } catch (e) { console.error('mail failed', e.message); } // never fail a booking because email failed
};
