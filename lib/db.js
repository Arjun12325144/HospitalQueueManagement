const mongoose = require('mongoose');
// Cache the connection so warm serverless invocations reuse it.
let cached = global._mongo || (global._mongo = { p: null });
exports.db = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  if (!cached.p) cached.p = mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false, maxPoolSize: 5 });
  await cached.p;
  const m = require('./models');
  await Promise.all([m.Appointment.init(), m.Doctor.init(), m.User.init()]); // make sure unique indexes exist
};
