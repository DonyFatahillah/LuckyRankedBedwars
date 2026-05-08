const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../data/autoconfirm.json');

// Default value in case file doesn't exist yet
let state = {
  enabled: false,
};

// Load from disk
function loadState() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      state = JSON.parse(data);
    } catch (err) {
      console.error('[AutoConfirm] Failed to load state:', err);
    }
  }
}

// Save to disk
function saveState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

// Public API
function isAutoConfirmEnabled() {
  return state.enabled;
}

function toggleAutoConfirm() {
  state.enabled = !state.enabled;
  saveState();
  return state.enabled;
}

// Init
loadState();

module.exports = {
  isAutoConfirmEnabled,
  toggleAutoConfirm,
};
