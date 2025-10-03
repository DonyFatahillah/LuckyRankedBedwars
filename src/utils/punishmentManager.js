const fs = require('fs');
const path = require('path');

const STRIKE_DB_PATH = path.join(__dirname, '../../data/strikeData.json');
const BAN_DB_PATH = path.join(__dirname, '../../data/rankedBans.json');

const RANKED_BANNED_ROLE_ID = process.env.RANKED_BANNED_ROLE_ID;
const STRIKE_ROLES = [
  process.env.STRIKE_I_ROLE_ID,
  process.env.STRIKE_II_ROLE_ID,
  process.env.STRIKE_III_ROLE_ID,
];

function loadJson(filePath) {
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    : {};
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function cleanupExpiredPunishments(client) {
  const strikeData = loadJson(STRIKE_DB_PATH);
  const banData = loadJson(BAN_DB_PATH);
  const now = Date.now();

  const guilds = client.guilds.cache;

  // Cleanup strikes
  for (const [userId, strike] of Object.entries(strikeData)) {
    const expired = new Date(strike.expiresAt).getTime() <= now;
    if (!expired) continue;

    for (const guild of guilds.values()) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;

      const role = STRIKE_ROLES[strike.level - 1];
      if (role && member.roles.cache.has(role)) {
        await member.roles.remove(role).catch(() => {});
      }
    }

    delete strikeData[userId];
    console.log(`[Strike] Removed expired strike from ${userId}`);
  }

  // Cleanup ranked bans
  for (const [userId, ban] of Object.entries(banData)) {
    if (ban.expiresAt <= now) {
      for (const guild of guilds.values()) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        if (member.roles.cache.has(RANKED_BANNED_ROLE_ID)) {
          await member.roles.remove(RANKED_BANNED_ROLE_ID).catch(() => {});
        }
      }

      delete banData[userId];
      console.log(`[Ban] Removed expired ranked ban from ${userId}`);
    }
  }

  saveJson(STRIKE_DB_PATH, strikeData);
  saveJson(BAN_DB_PATH, banData);
}

module.exports = {
  cleanupExpiredPunishments,
};
