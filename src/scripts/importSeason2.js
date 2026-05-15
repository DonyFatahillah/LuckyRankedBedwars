const fs = require('fs');
const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
const PlayerModel = require('../models/PlayerSchema');

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');
const ELO_PATH = path.join(__dirname, '../../data/elo.json');
const SEASON2_STATS_PATH = path.join(__dirname, '../../data/playerStats-season-2.json');
const SEASON2_ELO_PATH = path.join(__dirname, '../../data/elo-season-2.json');

async function importSeason2ToMongo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'RankedBedwars' });
    console.log('🚀 Connected to MongoDB');

    const stats = JSON.parse(fs.readFileSync(SEASON2_STATS_PATH, 'utf-8'));
    const elos = JSON.parse(fs.readFileSync(SEASON2_ELO_PATH, 'utf-8'));

    const allUserIds = new Set([
      ...Object.keys(stats),
      ...Object.keys(elos),
    ]);

    console.log(`📊 Found ${allUserIds.size} users to import from Season 2.`);

    for (const userId of allUserIds) {
      const s = stats[userId] || {};
      const elo = elos[userId] || 0;

      // Extract only IDs from recentlyPlayed if it's an array of objects
      const recentlyPlayedIds = Array.isArray(s.recentlyPlayed) 
        ? s.recentlyPlayed.map(item => (typeof item === 'object' ? item.id : item))
        : [];

      await PlayerModel.findOneAndUpdate(
        { userId },
        {
          userId,
          elo,
          wins: s.wins || 0,
          losses: s.losses || 0,
          winstreak: s.winstreak || 0,
          mvps: s.mvps || 0,
          bedsBroken: s.bedsBroken || 0,
          prefix: s.prefix !== undefined ? s.prefix : true,
          recentlyPlayed: recentlyPlayedIds,
          lastPlayedAt: s.lastPlayedAt || 0,
          discordUsername: s.discordUsername || null,
          ingameUsername: s.username || null, // Map 'username' to 'ingameUsername'
        },
        { upsert: true, returnDocument: 'after' }
      );
      console.log(`✅ Imported: ${s.username || userId}`);
    }

    console.log('🎉 Successfully imported Season 2 data to MongoDB.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Import failed:', err);
    process.exit(1);
  }
}

importSeason2ToMongo();
