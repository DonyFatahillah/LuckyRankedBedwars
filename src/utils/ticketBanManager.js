const TicketBanModel = require('../models/TicketBanSchema');

async function banUser(userId, duration = 0, reason = 'No reason') {
  const expiresAt = duration > 0 ? new Date(Date.now() + duration * 1000) : null;
  await TicketBanModel.findOneAndUpdate(
    { userId },
    { userId, expiresAt, reason },
    { upsert: true }
  );
}

async function unbanUser(userId) {
  await TicketBanModel.deleteOne({ userId });
}

async function isBanned(userId) {
  const ban = await TicketBanModel.findOne({ userId });
  if (!ban) return false;

  // Check if temporary ban expired
  if (ban.expiresAt && new Date() > ban.expiresAt) {
    await ban.deleteOne();
    return false;
  }
  return true;
}

async function getBanInfo(userId) {
  return await TicketBanModel.findOne({ userId });
}

module.exports = { banUser, unbanUser, isBanned, getBanInfo };
