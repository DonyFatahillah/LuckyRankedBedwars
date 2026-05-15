const PunishmentModel = require('../models/PunishmentSchema');

const RANKED_BANNED_ROLE_ID = process.env.RANKED_BANNED_ROLE_ID;
const STRIKE_ROLES = [
  process.env.STRIKE_I_ROLE_ID,
  process.env.STRIKE_II_ROLE_ID,
  process.env.STRIKE_III_ROLE_ID,
];

async function cleanupExpiredPunishments(client) {
  const now = new Date();
  
  // Find all expired punishments
  const expiredPunishments = await PunishmentModel.find({ expiresAt: { $lte: now } });

  for (const punishment of expiredPunishments) {
    const { userId, type, level } = punishment;

    for (const guild of client.guilds.cache.values()) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;

      if (type === 'strike') {
        const role = STRIKE_ROLES[level - 1];
        if (role && member.roles.cache.has(role)) {
          await member.roles.remove(role).catch(() => {});
        }
      } else if (type === 'ban') {
        if (RANKED_BANNED_ROLE_ID && member.roles.cache.has(RANKED_BANNED_ROLE_ID)) {
          await member.roles.remove(RANKED_BANNED_ROLE_ID).catch(() => {});
        }
      }
    }

    await PunishmentModel.deleteOne({ _id: punishment._id });
    console.log(`[Punishment] Removed expired ${type} from ${userId}`);
  }
}

module.exports = {
  cleanupExpiredPunishments,
};
