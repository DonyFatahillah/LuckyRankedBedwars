const fs = require('fs');
const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
const PlayerModel = require('../models/PlayerSchema');

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');
const ELO_PATH = path.join(__dirname, '../../data/elo.json');

async function cacheMongoToLocal() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'PlayerStats' });
    console.log('🚀 Connected to MongoDB');

    const players = await PlayerModel.find({});
    console.log(`📊 Found ${players.length} players in MongoDB.`);

    const playerStats = {};
    const eloData = {};

    for (const p of players) {
      playerStats[p.userId] = {
        wins: p.wins || 0,
        losses: p.losses || 0,
        winstreak: p.winstreak || 0,
        mvps: p.mvps || 0,
        bedsBroken: p.bedsBroken || 0,
        prefix: p.prefix,
        recentlyPlayed: p.recentlyPlayed || [],
        lastPlayedAt: p.lastPlayedAt || 0,
        discordUsername: p.discordUsername || null,
        ingameUsername: p.ingameUsername || null,
      };
      eloData[p.userId] = p.elo || 0;
    }

    fs.writeFileSync(STATS_PATH, JSON.stringify(playerStats, null, 2));
    fs.writeFileSync(ELO_PATH, JSON.stringify(eloData, null, 2));

    console.log('🎉 Successfully cached data from MongoDB to local files.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Caching failed:', err);
    process.exit(1);
  }
}

cacheMongoToLocal();
