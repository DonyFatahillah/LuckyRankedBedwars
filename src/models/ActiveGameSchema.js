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
  submittingTeam: { type: String, default: null }, // 'A' or 'B'
  pickingPhase: { type: Boolean, default: false },
  pickingTurn: { type: String, default: null }, // userId of the captain whose turn it is
  unpickedPlayers: { type: [String], default: [] }, // userIds of players yet to be picked
  isPlayerPicking: { type: Boolean, default: false },
  isArenaPicking: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('ActiveGame', activeGameSchema, 'ActiveGames');
