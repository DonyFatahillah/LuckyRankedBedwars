require('dotenv').config();
const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');
const PlayerModel = require('../models/PlayerSchema');

async function syncDiscordUsernames() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'RankedBedwars' });
    console.log('🚀 Connected to MongoDB');

    await client.login(process.env.DISCORD_TOKEN);
    console.log('🤖 Logged into Discord');

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const players = await PlayerModel.find({});

    console.log(`📊 Syncing ${players.length} players...`);

    for (const player of players) {
      try {
        const member = await guild.members.fetch(player.userId);
        if (member && member.user.username !== player.discordUsername) {
          player.discordUsername = member.user.username;
          await player.save();
          console.log(`✅ Updated ${player.userId}: ${member.user.username}`);
        }
      } catch (err) {
        console.warn(`⚠️ Could not fetch member ${player.userId}`);
      }
    }

    console.log('🎉 Sync complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  }
}

syncDiscordUsernames();
