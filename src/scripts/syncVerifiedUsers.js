require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { deletePlayerCache } = require('../utils/redisClient');
const PlayerModel = require('../models/PlayerSchema');

async function syncVerifiedUsers() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  try {
    await client.login(process.env.DISCORD_TOKEN);
    console.log('🤖 Logged into Discord for sync');

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const players = await PlayerModel.find({});

    const verifiedRoleId = process.env.VERIFIED_ROLE_ID;

    for (const player of players) {
      try {
        const member = await guild.members.fetch(player.userId).catch(() => null);

        // If player is no longer in the guild or not verified
        if (!member || !member.roles.cache.has(verifiedRoleId)) {
          // Logic: Remove roles and reset nickname
          if (member) {
            await member.roles.remove(verifiedRoleId).catch(console.error);
            await member.setNickname(member.user.username).catch(console.error);
            console.log(`🧹 Cleaned up ${member.user.username}`);
          }

          // Clean Redis cache
          await deletePlayerCache(player.userId);
        }
      } catch (err) {
        console.warn(`⚠️ Error processing player ${player.userId}: ${err.message}`);
      }
    }

    console.log('🎉 Verified user sync complete.');
  } catch (err) {
    console.error('❌ Sync failed:', err);
  } finally {
    client.destroy();
  }
}

module.exports = syncVerifiedUsers;
