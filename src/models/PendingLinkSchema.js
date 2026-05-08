const mongoose = require('mongoose');

const pendingLinkSchema = new mongoose.Schema({
  linkCode_1: { type: String, required: true, unique: true },
  username_1: { type: String, required: true },
  expiry_1: { type: Date, required: true }
});

// Auto-delete expired codes after 1 second of expiry
pendingLinkSchema.index({ expiry_1: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PendingLink', pendingLinkSchema, 'PendingLinks');
