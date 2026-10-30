const PlayerModel = require('../models/PlayerSchema');

const KILL_DEATH_FIELDS = ['kills', 'deaths', 'double_kills', 'double_deaths'];

async function migrateKillDeathStats() {
  console.log('[KillDeath Migration] Checking player documents for missing normal/doubles kill and death stats...');

  try {
    let initializedFields = 0;

    // Completed documents never match. Partial documents retain existing values.
    for (const field of KILL_DEATH_FIELDS) {
      const result = await PlayerModel.updateMany(
        { [field]: { $exists: false } },
        { $set: { [field]: 0 } }
      );
      initializedFields += result.modifiedCount;
      console.log(`[KillDeath Migration] ${field}: initialized for ${result.modifiedCount} player(s).`);
    }

    const remaining = await PlayerModel.countDocuments({
      $or: KILL_DEATH_FIELDS.map(field => ({ [field]: { $exists: false } }))
    });

    if (remaining > 0) {
      throw new Error(`${remaining} player document(s) are still missing kill/death stats.`);
    }

    console.log(`[KillDeath Migration] SUCCESS: initialized ${initializedFields} missing field value(s). Verified no player documents are missing kill/death stats. Existing values preserved.`);
    return { initializedFields, remaining };
  } catch (err) {
    console.error('[KillDeath Migration] FAILED:', err);
    throw err;
  }
}

module.exports = migrateKillDeathStats;
