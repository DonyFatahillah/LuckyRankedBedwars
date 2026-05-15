const mongoose = require('mongoose');

const partySettingsSchema = new mongoose.Schema({
  settingKey: { type: String, required: true, unique: true }, // e.g., 'partyMatchEnabled', 'partyLimit'
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

module.exports = mongoose.model('PartySettings', partySettingsSchema, 'PartySettings');
