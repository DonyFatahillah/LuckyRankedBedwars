const mongoose = require('mongoose');

const ticketBanSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  expiresAt: { type: Date, default: null }, // Null for permanent
  reason: { type: String, default: 'No reason' }
}, { timestamps: true });

module.exports = mongoose.model('TicketBan', ticketBanSchema, 'TicketBans');
