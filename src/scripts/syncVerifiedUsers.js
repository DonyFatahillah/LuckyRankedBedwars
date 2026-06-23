require('dotenv').config();
const { deletePlayerCache } = require('../utils/redisClient');
const PlayerModel = require('../models/PlayerSchema');

/**
 * Syncs verified users by checking MongoDB players against the guild.
 * If a player has a DB entry but is no longer in the guild or lost their
 * verified role, their Redis cache is cleared and their nickname/roles reset.
 *
 * NOTE: Must be called AFTER the main client is ready and guild members
 * have been fetched, so that member.roles.cache is fully populated.
 *
 * @param {import('discord.js').Client} client - The main bot client
 * @param {import('discord.js').Collection} [membersArg] - Pre-fetched members (optional)
 */
async function syncVerifiedUsers(client, membersArg = null) {
  const guildId = process.env.GUILD_ID;
  const verifiedRoleId = process.env.VERIFIED_ROLE_ID;

  if (!guildId) {
    console.error('[Verified Sync] Missing GUILD_ID in .env');
    return;
  }
  if (!verifiedRoleId) {
    console.error('[Verified Sync] Missing VERIFIED_ROLE_ID in .env');
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error('[Verified Sync] Failed to fetch guild');
    return;
  }

  // Use pre-fetched members if provided (avoids a redundant API call),
  // otherwise fetch them now. A bulk fetch ensures roles.cache is populated.
  const members = membersArg || await guild.members.fetch({ withPresences: false });
  console.log(`[Verified Sync] Processing ${members.size} members against MongoDB...`);

  let players;
  try {
    players = await PlayerModel.find({});
  } catch (err) {
    console.error('[Verified Sync] Failed to fetch players from MongoDB:', err);
    return;
  }

  let cleanedCount = 0;

  for (const player of players) {
    try {
      // Look up the member from the already-fetched collection (no extra API call)
      const member = members.get(player.userId) || null;

      // Player is no longer in the guild or lost their verified role
      if (!member || !member.roles.cache.has(verifiedRoleId)) {
        if (member) {
          // Member is still in guild but lost verified role — clean up their Discord state
          await member.roles.remove(verifiedRoleId).catch(console.error);
          await member.setNickname(member.user.username).catch(console.error);
          console.log(`🧹 Cleaned up ${member.user.username}`);
        }

        // Always clear the Redis cache so stale data doesn't linger
        await deletePlayerCache(player.userId);
        cleanedCount++;
      }
    } catch (err) {
      console.warn(`⚠️ Error processing player ${player.userId}: ${err.message}`);
    }
  }

  console.log(`🎉 Verified user sync complete. Cleaned up ${cleanedCount} players.`);
}

module.exports = syncVerifiedUsers;
