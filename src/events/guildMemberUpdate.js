const { Events } = require('discord.js');
const Player = require('../models/Player');
const PlayerModel = require('../models/PlayerSchema');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (newMember.user.bot) return;

    const premiumRoleId = process.env.PREMIUM_ROLE_ID;
    const pugsRoleId = process.env.PUGS_ROLE_ID;
    const pitsRoleId = process.env.PITS_ROLE_ID;
    const pupsRoleId = process.env.PUPS_ROLE_ID;

    const relevantRoleIds = [premiumRoleId, pugsRoleId, pitsRoleId, pupsRoleId].filter(Boolean);
    if (relevantRoleIds.length === 0) return;

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    // Detect if any of the targeted premium/queue roles changed
    let roleChanged = false;
    for (const roleId of relevantRoleIds) {
      if (oldRoles.has(roleId) !== newRoles.has(roleId)) {
        roleChanged = true;
        break;
      }
    }

    if (roleChanged) {
      console.log(`[Role Change] Role update detected for ${newMember.user.tag} (${newMember.id})`);
      try {
        const hasPremium = premiumRoleId ? newRoles.has(premiumRoleId) : false;
        const hasPugs = pugsRoleId ? newRoles.has(pugsRoleId) : false;
        const hasPits = pitsRoleId ? newRoles.has(pitsRoleId) : false;
        const hasPups = pupsRoleId ? newRoles.has(pupsRoleId) : false;

        const isPremium = hasPremium || hasPugs || hasPits || hasPups;

        // Check if the user exists in the database
        const existsInDb = await PlayerModel.exists({ userId: newMember.id });

        // Sync if they have premium roles or already exist in the database
        if (isPremium || existsInDb) {
          const player = await Player.load(newMember);
          await player.save();
          console.log(`[Role Change] Successfully synced details/premium status for ${newMember.user.tag}`);
        }
      } catch (err) {
        console.error(`[Role Change] Error syncing player details for ${newMember.id}:`, err);
      }
    }
  }
};
