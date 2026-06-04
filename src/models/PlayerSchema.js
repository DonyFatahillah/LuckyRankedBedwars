const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  elo: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  winstreak: { type: Number, default: 0 },
  mvps: { type: Number, default: 0 },
  bedsBroken: { type: Number, default: 0 },
  prefix: { type: Boolean, default: true },
  recentlyPlayed: { type: [String], default: [] },
  lastPlayedAt: { type: Number, default: 0 },
  discordUsername: { type: String, default: null },
  ingameUsername: { type: String, default: null },
  displayUsername: { type: String, default: null },
  minecraftUuid: { type: String, default: null },
  lastIgnUpdate: { type: Number, default: 0 },
  linkCode: { type: String, default: null },
  linkExpiry: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema, 'PlayerStats');
