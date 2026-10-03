const mongoose = require('mongoose');
const { Schema } = mongoose;

const user = new Schema({ googleId: String, email: { type: String, unique: true, lowercase: true, trim: true }, name: String, picture: String }, { timestamps: true });

const week = () => [0, 1, 2, 3, 4, 5, 6].map(i => ({ on: i !== 0, start: '09:00', end: '17:00' })); // index 0 = Sunday
const doctor = new Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true, trim: true }, // the Google account this doctor signs in with
  department: String,
  fee: { type: Number, default: 0 }, // rupees
  code: { type: String, unique: true }, // token prefix, e.g. RAO
  active: { type: Boolean, default: true },
  weekly: { type: [{ _id: false, on: Boolean, start: String, end: String }], default: week },
  off: { type: [String], default: [] }, // days off, YYYY-MM-DD
}, { timestamps: true });

const appt = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  patientName: String, phone: String, email: String,
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor' }, doctorName: String, department: String,
  date: String, slot: String,
  // Unique while the appointment holds its slot. Removed on cancel so the slot can be booked again.
  slotKey: { type: String, unique: true, sparse: true },
  token: Number, label: String,
  priority: { type: Number, default: 0 }, // 0 normal, 1 senior
  status: { type: String, enum: ['booked', 'serving', 'done', 'noshow', 'cancelled'], default: 'booked' },
  payment: { mode: String, status: { type: String, default: 'pending' }, amount: Number, orderId: String, paymentId: String, paidAt: Date },
  calledAt: Date, doneAt: Date,
}, { timestamps: true });
appt.index({ doctorId: 1, date: 1, status: 1 });
appt.index({ 'payment.orderId': 1 });

const counter = new Schema({ _id: String, seq: { type: Number, default: 0 } });

exports.User = mongoose.models.User || mongoose.model('User', user);
exports.Doctor = mongoose.models.Doctor || mongoose.model('Doctor', doctor);
exports.Appointment = mongoose.models.Appointment || mongoose.model('Appointment', appt);
exports.Counter = mongoose.models.Counter || mongoose.model('Counter', counter);
