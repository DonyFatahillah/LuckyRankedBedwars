const PlayerModel = require('../models/PlayerSchema');

const DOUBLE_STATS_FIELDS = [
  'double_elo',
  'double_wins',
  'double_losses',
  'double_winstreaks',
  'double_bedsbroken'
];

async function migrateDoubleStats() {
  console.log('[DoubleStats Migration] Checking player documents for missing doubles stats...');

  try {
    let initializedFields = 0;

    // Completed documents match none of these queries and are never written.
    // For partial documents, initialize only missing fields, preserving existing values.
    for (const field of DOUBLE_STATS_FIELDS) {
      const result = await PlayerModel.updateMany(
        { [field]: { $exists: false } },
        { $set: { [field]: 0 } }
      );
      initializedFields += result.modifiedCount;
      console.log(`[DoubleStats Migration] ${field}: initialized for ${result.modifiedCount} player(s).`);
    }

    const remaining = await PlayerModel.countDocuments({
      $or: DOUBLE_STATS_FIELDS.map(field => ({ [field]: { $exists: false } }))
    });

    if (remaining > 0) {
      throw new Error(`${remaining} player document(s) are still missing doubles stats.`);
    }

    console.log(`[DoubleStats Migration] SUCCESS: initialized ${initializedFields} missing field value(s). Verified no player documents are missing doubles stats. Existing values preserved.`);
    return { initializedFields, remaining };
  } catch (err) {
    console.error('[DoubleStats Migration] FAILED:', err);
    throw err;
  }
}

module.exports = migrateDoubleStats;

// Standalone execution owns its connection; startup reuses the bot's connection.
if (require.main === module) {
  require('dotenv').config({ path: __dirname + '/../../.env' });
  const mongoose = require('mongoose');
  const connectDB = require('../config/database');

  (async () => {
    try {
      await connectDB();
      await migrateDoubleStats();
    } catch (err) {
      process.exitCode = 1;
    } finally {
      await mongoose.connection.close();
    }
  })().catch(err => {
    console.error('[DoubleStats Migration] Standalone execution failed:', err);
    process.exitCode = 1;
  });
}
