const fs = require('fs');
const path = require('path');

// Adds the doubles version of bedsBroken ("double_bedsbroken") to local player stat files.
// MongoDB documents are handled by migrateDoubleStats.js (runs at startup); this covers the
// local JSON stores the same way addBedBreakField.js covers "bedsBroken".

const STATS_FILES = [
  path.join(__dirname, '../../data/playerStats.json'),
  path.join(__dirname, '../../data/playerStats-season-1.json'),
  path.join(__dirname, '../../data/playerStats-season-2.json')
];

function addDoubleBedBreakField() {
  for (const statsPath of STATS_FILES) {
    if (!fs.existsSync(statsPath)) {
      console.log(`[Migration] ${path.basename(statsPath)} does not exist, skipping.`);
      continue;
    }

    let stats;
    try {
      stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
    } catch (err) {
      console.error(`[Migration] Failed to parse ${path.basename(statsPath)}:`, err);
      continue;
    }

    let modified = false;
    for (const id in stats) {
      if (stats[id].double_bedsbroken === undefined) {
        stats[id].double_bedsbroken = 0;
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
      console.log(`[Migration] ✅ Added "double_bedsbroken: 0" to old entries in ${path.basename(statsPath)}.`);
    } else {
      console.log(`[Migration] No changes needed in ${path.basename(statsPath)}. All entries already have "double_bedsbroken".`);
    }
  }
}

module.exports = addDoubleBedBreakField;

// Standalone execution: node src/scripts/addDoubleBedBreakField.js
if (require.main === module) {
  addDoubleBedBreakField();
}
