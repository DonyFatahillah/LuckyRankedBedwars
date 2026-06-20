// src/scripts/syncPremium.js
const Player = require('../models/Player');
const PlayerModel = require('../models/PlayerSchema');

module.exports = async function syncPremium(client, membersArg = null) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) {
    console.error('[Premium Sync] Missing GUILD_ID in .env');
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error('[Premium Sync] Failed to fetch guild');
    return;
  }

  console.log('[Premium Sync] Starting premium role sync...');

  // Roles to check
  const premiumRoleId = process.env.PREMIUM_ROLE_ID;
  const pugsRoleId = process.env.PUGS_ROLE_ID;
  const pitsRoleId = process.env.PITS_ROLE_ID;
  const pupsRoleId = process.env.PUPS_ROLE_ID;

  const roleIds = [premiumRoleId, pugsRoleId, pitsRoleId, pupsRoleId].filter(Boolean);
  if (roleIds.length === 0) {
    console.log('[Premium Sync] No premium role IDs defined in .env');
    return;
  }

  // Fetch all members of the guild or use provided members
  const members = membersArg || await guild.members.fetch({ withPresences: false });
  console.log(`[Premium Sync] Processing ${members.size} total members...`);

  // Load existing player userIds from MongoDB to check who is already in the DB
  const existingUserIds = new Set();
  try {
    const dbPlayers = await PlayerModel.find({}, 'userId').lean();
    dbPlayers.forEach(p => existingUserIds.add(p.userId));
  } catch (err) {
    console.error('[Premium Sync] Failed to fetch players from MongoDB:', err);
  }

  let updatedCount = 0;

  for (const [userId, member] of members) {
    if (member.user.bot) continue;

    const hasPremium = premiumRoleId ? member.roles.cache.has(premiumRoleId) : false;
    const hasPugs = pugsRoleId ? member.roles.cache.has(pugsRoleId) : false;
    const hasPits = pitsRoleId ? member.roles.cache.has(pitsRoleId) : false;
    const hasPups = pupsRoleId ? member.roles.cache.has(pupsRoleId) : false;

    const isPremium = hasPremium || hasPugs || hasPits || hasPups;
    const premiumData = isPremium ? {
      premium: hasPremium,
      pugs: hasPugs,
      pits: hasPits,
      pups: hasPups
    } : null;

    const existsInDb = existingUserIds.has(userId);

    // If they have a premium role OR they already exist in the database, we sync them
    if (isPremium || existsInDb) {
      try {
        const player = await Player.load(member);
        
        const prevIsPremium = player.isPremium;
        const prevPremium = player.premium;

        const needsUpdate = prevIsPremium !== isPremium || 
                            JSON.stringify(prevPremium) !== JSON.stringify(premiumData);

        if (needsUpdate) {
          player.isPremium = isPremium;
          player.premium = premiumData;
          await player.save();
          updatedCount++;
        }
      } catch (err) {
        console.error(`[Premium Sync] Error syncing user ${userId}:`, err);
      }
    }
  }

  console.log(`[Premium Sync] Premium role sync complete. Updated ${updatedCount} players.`);
};
