const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');

function addBedBrokenField() {
  if (!fs.existsSync(STATS_PATH)) {
    console.error('[Migration] playerStats.json does not exist.');
    return;
  }

  let stats;
  try {
    stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  } catch (err) {
    console.error('[Migration] Failed to parse playerStats.json:', err);
    return;
  }

  let modified = false;
  for (const id in stats) {
    if (stats[id].bedsBroken === undefined) {
      stats[id].bedsBroken = 0;
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
    console.log('[Migration] ✅ Added "bedsBroken: 0" to old player entries.');
  } else {
    console.log('[Migration] No changes needed. All entries already have "bedsBroken".');
  }
}

// ✅ Export the function
module.exports = addBedBrokenField;
