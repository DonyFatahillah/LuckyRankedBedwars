const mongoose = require('mongoose');
const PlayerModel = require('../models/PlayerSchema');
const connectDB = require('../config/database');
require('dotenv').config({ path: __dirname + '/../../.env' });

async function migrate() {
  await connectDB();
  console.log('[Migration] Connected to MongoDB.');

  try {
    const result = await PlayerModel.updateMany(
      { double_elo: { $exists: false } },
      { 
        $set: { 
          double_elo: 0,
          double_wins: 0,
          double_losses: 0,
          double_winstreaks: 0,
          double_bedsbroken: 0
        }
      }
    );
    console.log(`[Migration] Updated ${result.modifiedCount} players with double stats fields.`);
  } catch (err) {
    console.error('[Migration] Failed:', err);
  } finally {
    mongoose.connection.close();
    console.log('[Migration] Database connection closed.');
  }
}

migrate();
