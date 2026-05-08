const mongoose = require('mongoose');

const activeGameSchema = new mongoose.Schema({
  gameId: { type: String, required: true, unique: true },
  channelId: { type: String, required: true },
  categoryId: { type: String, required: true },
  queueType: { type: String, required: true },
  players: { type: [String], required: true }, // [p1, p2, p3, p4]
  teamA: { type: [String], required: true },
  teamB: { type: [String], required: true },
  map: { type: String, required: true },
  voiceAId: { type: String },
  voiceBId: { type: String },
  startedAt: { type: Number, required: true },
  submitted: { type: Boolean, default: false },
  submittingTeam: { type: String, default: null } // 'A' or 'B'
}, { timestamps: true });

module.exports = mongoose.model('ActiveGame', activeGameSchema, 'ActiveGames');
