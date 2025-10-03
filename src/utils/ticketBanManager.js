const fs = require('fs');
const path = require('path');

const TICKET_BANS_PATH = path.join(__dirname, '../../data/ticketBans.json');

let bans = {};
if (fs.existsSync(TICKET_BANS_PATH)) {
  try { bans = JSON.parse(fs.readFileSync(TICKET_BANS_PATH, 'utf8')); } 
  catch (e) { console.error('[TicketBanManager] Failed to load:', e); }
}

function saveBans() {
  fs.writeFileSync(TICKET_BANS_PATH, JSON.stringify(bans, null, 2));
}

function banUser(userId, duration = 0, reason = 'No reason') {
  const expiresAt = duration > 0 ? Date.now() + duration * 1000 : 0;
  bans[userId] = { expiresAt, reason };
  saveBans();
}

function unbanUser(userId) {
  delete bans[userId];
  saveBans();
}

function isBanned(userId) {
  const ban = bans[userId];
  if (!ban) return false;
  if (ban.expiresAt && Date.now() > ban.expiresAt) {
    // Temporary ban expired
    delete bans[userId];
    saveBans();
    return false;
  }
  return true;
}

function getBanInfo(userId) {
  return bans[userId] || null;
}

module.exports = { banUser, unbanUser, isBanned, getBanInfo };
