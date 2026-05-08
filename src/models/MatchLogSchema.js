const mongoose = require('mongoose');

const matchLogSchema = new mongoose.Schema({
  matchId: { type: String, required: true, unique: true },
  timestamp: { type: Number, required: true },
  queueType: { type: String, required: true },
  winners: { type: [String], required: true },
  losers: { type: [String], required: true },
  mvp: { type: String, default: null },
  bedbreaker: { type: String, default: null },
  eloGains: { type: Map, of: Number, default: {} },
  eloLosses: { type: Map, of: Number, default: {} },
  mapName: { type: String, default: 'Unknown' },
  status: { type: String, default: 'Confirmed' } // 'Pending', 'Confirmed', 'Voided'
}, { timestamps: true });

module.exports = mongoose.model('MatchLog', matchLogSchema, 'MatchLogs');
