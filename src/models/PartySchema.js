const mongoose = require('mongoose');

const partySchema = new mongoose.Schema({
  leaderId: { type: String, required: true, unique: true },
  members: { type: [String], required: true },
  createdAt: { type: Number, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Party', partySchema, 'Parties');
