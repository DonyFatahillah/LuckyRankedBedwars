const PlayerModel = require('../models/PlayerSchema');

const RESOURCE_FIELDS = [
  'diamonds', 'emeralds', 'iron', 'gold',
  'double_diamonds', 'double_emeralds', 'double_iron', 'double_gold'
];

// Uses the bot's existing database connection; never closes the shared connection.
async function migrateResourceStats() {
  console.log('[ResourceStats Migration] Checking player documents for missing normal/doubles resource stats...');

  try {
    let initializedFields = 0;

    // Completed documents never match. Partial documents retain existing values.
    for (const field of RESOURCE_FIELDS) {
      const result = await PlayerModel.updateMany(
        { [field]: { $exists: false } },
        { $set: { [field]: 0 } }
      );
      initializedFields += result.modifiedCount;
      console.log(`[ResourceStats Migration] ${field}: initialized for ${result.modifiedCount} player(s).`);
    }

    const remaining = await PlayerModel.countDocuments({
      $or: RESOURCE_FIELDS.map(field => ({ [field]: { $exists: false } }))
    });

    if (remaining > 0) {
      throw new Error(`${remaining} player document(s) are still missing resource stats.`);
    }

    console.log(`[ResourceStats Migration] SUCCESS: initialized ${initializedFields} missing field value(s). Verified no player documents are missing resource stats. Existing values preserved.`);
    return { initializedFields, remaining };
  } catch (err) {
    console.error('[ResourceStats Migration] FAILED:', err);
    throw err;
  }
}

module.exports = migrateResourceStats;
