// src/utils/partyModeManager.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../../data/partyMatch.json');

let partyMatch = false;

// ✅ Load the party match state safely
function loadPartyMatch() {
  try {
    if (fs.existsSync(FILE)) {
      const raw = fs.readFileSync(FILE, 'utf-8');
      partyMatch = JSON.parse(raw);
    }
  } catch (err) {
    console.error('[PartyModeManager] Failed to load party match state:', err);
    partyMatch = false;
  }
}

// ✅ Get current state
function isPartyMatch() {
  return partyMatch;
}

// ✅ Set and persist state (async version)
async function setPartyMatch(state) {
  partyMatch = Boolean(state);
  try {
    await fs.promises.writeFile(FILE, JSON.stringify(partyMatch, null, 2), 'utf-8');
  } catch (err) {
    console.error('[PartyModeManager] Failed to save party match state:', err);
  }
}

// ✅ Initialize on module load
loadPartyMatch();

module.exports = {
  isPartyMatch,
  setPartyMatch
};
