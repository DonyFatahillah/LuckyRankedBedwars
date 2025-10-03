const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../data/matchLogs.json'); // adjust if needed

function cleanMatchLogs() {
  if (!fs.existsSync(LOG_FILE)) return;

  const raw = fs.readFileSync(LOG_FILE, 'utf-8');
  let data;

  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('❌ [StartupCleanup] Failed to parse matchLogs.json:', err);
    return;
  }

  // Already object-style — nothing to do
  if (!Array.isArray(data)) {
    console.log('✅ [StartupCleanup] matchLogs.json is already clean.');
    return;
  }

  const cleaned = {};

  for (const entry of data) {
    if (entry && typeof entry === 'object' && entry.gameId) {
      cleaned[entry.gameId] = entry;
    }
  }

  fs.writeFileSync(LOG_FILE, JSON.stringify(cleaned, null, 2));
  console.log(`✅ [StartupCleanup] Cleaned matchLogs.json — kept ${Object.keys(cleaned).length} matches.`);
}

module.exports = cleanMatchLogs;
