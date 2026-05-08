const fs = require('fs');
const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
const PlayerModel = require('../models/PlayerSchema');

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');
const ELO_PATH = path.join(__dirname, '../../data/elo.json');

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'PlayerStats' });
    console.log('🚀 Connected to MongoDB');

    let playerStats = {};
    if (fs.existsSync(STATS_PATH)) {
      playerStats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
    }

    let eloData = {};
    if (fs.existsSync(ELO_PATH)) {
      eloData = JSON.parse(fs.readFileSync(ELO_PATH, 'utf-8'));
    }

    const allUserIds = new Set([
      ...Object.keys(playerStats),
      ...Object.keys(eloData),
    ]);

    console.log(`📊 Found ${allUserIds.size} users to migrate.`);

    for (const userId of allUserIds) {
      const stats = playerStats[userId] || {};
      const elo = eloData[userId] || 0;

      await PlayerModel.findOneAndUpdate(
        { userId },
        {
          userId,
          elo,
          wins: stats.wins || 0,
          losses: stats.losses || 0,
          winstreak: stats.winstreak || 0,
          mvps: stats.mvps || 0,
          bedsBroken: stats.bedsBroken || 0,
          prefix: stats.prefix !== undefined ? stats.prefix : true,
          recentlyPlayed: stats.recentlyPlayed || [],
          lastPlayedAt: stats.lastPlayedAt || 0,
          discordUsername: stats.discordUsername || null,
          ingameUsername: stats.ingameUsername || null,
        },
        { upsert: true, new: true }
      );
      console.log(`✅ Migrated user: ${userId}`);
    }

    console.log('🎉 Migration to MongoDB completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
