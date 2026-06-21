const mongoose = require('mongoose');

const pendingLinkSchema = new mongoose.Schema({
  linkCode: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  expiry: { type: Date, required: true }
});

// Auto-delete expired codes after 1 second of expiry
pendingLinkSchema.index({ expiry: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PendingLink', pendingLinkSchema, 'PendingLinks');
