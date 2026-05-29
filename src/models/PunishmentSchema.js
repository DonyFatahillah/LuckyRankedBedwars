const mongoose = require('mongoose');

const punishmentSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, enum: ['strike', 'ban'], required: true },
  level: { type: Number }, // For strikes (1, 2, 3)
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Punishment', punishmentSchema, 'Punishments');
