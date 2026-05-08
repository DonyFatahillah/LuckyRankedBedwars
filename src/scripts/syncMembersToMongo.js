const { Client, IntentsBitField } = require('discord.js');
const mongoose = require('mongoose');
const PlayerModel = require('../models/PlayerSchema');
require('dotenv').config();

const VERIFIED_ROLE_ID = '1401289452633985086';

async function sync() {
  try {
    console.log('⏳ Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'PlayerStats' });
    console.log('✅ Connected to MongoDB');

    const client = new Client({
      intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMembers],
    });

    console.log('⏳ Logging into Discord...');
    await client.login(process.env.DISCORD_TOKEN);
    
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    console.log(`⏳ Fetching members for ${guild.name}...`);
    const members = await guild.members.fetch();
    
    const verifiedMembers = members.filter(m => m.roles.cache.has(VERIFIED_ROLE_ID) && !m.user.bot);
    console.log(`📊 Found ${verifiedMembers.size} verified human members.`);

    let created = 0;
    let updated = 0;

    for (const [id, member] of verifiedMembers) {
      const result = await PlayerModel.findOneAndUpdate(
        { userId: id },
        { 
          $setOnInsert: { 
            userId: id,
            elo: 0,
            wins: 0,
            losses: 0,
            winstreak: 0,
            mvps: 0,
            bedsBroken: 0,
            recentlyPlayed: [],
            lastPlayedAt: 0,
            ingameUsername: null
          },
          $set: { 
            discordUsername: member.user.username 
          }
        },
        { upsert: true, new: true, includeResultMetadata: true }
      );

      if (result.lastErrorObject && result.lastErrorObject.updatedExisting) {
        updated++;
      } else {
        created++;
      }
    }

    console.log(`
🎉 Sync Complete!`);
    console.log(`✨ New records created: ${created}`);
    console.log(`🔄 Discord usernames updated: ${updated}`);
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  }
}

sync();
