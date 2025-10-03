const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const VERIFIED_PATH = path.join(DATA_DIR, 'verifiedUsers.json');

let verifiedData = {};

// ─────────────────────────────────────────────
// Ensure data file and directory exist
function initializeVerifiedData() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(VERIFIED_PATH)) {
    fs.writeFileSync(VERIFIED_PATH, JSON.stringify({}, null, 2));
  }

  try {
    const raw = fs.readFileSync(VERIFIED_PATH, 'utf8');
    verifiedData = JSON.parse(raw);
  } catch (err) {
    console.error('[Verified] Failed to load verifiedUsers.json:', err);
    verifiedData = {};
  }
}

// ─────────────────────────────────────────────
// Helpers
function saveVerifiedData() {
  try {
    fs.writeFileSync(VERIFIED_PATH, JSON.stringify(verifiedData, null, 2), 'utf8');
  } catch (err) {
    console.error('[Verified] Failed to save verifiedUsers.json:', err);
  }
}

// ─────────────────────────────────────────────
// Public API
function getNickname(userId) {
  return verifiedData[userId] || null;
}

function setNickname(userId, nickname) {
  verifiedData[userId] = nickname;
  saveVerifiedData();
}

// ─────────────────────────────────────────────
// Init on load
initializeVerifiedData();

module.exports = {
  getNickname,
  setNickname,
};
