const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const ELO_PATH = path.join(DATA_DIR, 'elo.json');

let eloData = {};

// ─────────────────────────────────────────────
// Ensure `data/elo.json` exists and is valid
function initializeEloFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(ELO_PATH)) {
    fs.writeFileSync(ELO_PATH, JSON.stringify({}), 'utf8');
  }

  try {
    const raw = fs.readFileSync(ELO_PATH, 'utf8');
    eloData = JSON.parse(raw);
  } catch (err) {
    console.error('[ELO] Failed to load elo.json. Resetting.', err);
    eloData = {};
    fs.writeFileSync(ELO_PATH, JSON.stringify(eloData, null, 2));
  }
}

// ─────────────────────────────────────────────
// Public Interface
function getElo(userId) {
  return eloData[userId] ?? 0;
}

function setElo(userId, newElo) {
  eloData[userId] = newElo;
  saveEloData();
}

function saveEloData() {
  try {
    fs.writeFileSync(ELO_PATH, JSON.stringify(eloData, null, 2), 'utf8');
  } catch (err) {
    console.error('[ELO] Failed to save elo.json:', err);
  }
}

// ─────────────────────────────────────────────
// Init on load
initializeEloFile();

module.exports = {
  getElo,
  setElo,
};
