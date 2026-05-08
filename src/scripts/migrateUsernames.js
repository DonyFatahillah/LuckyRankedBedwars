// script/migrateUsernames.js
const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');
let stats = {};

if (fs.existsSync(STATS_PATH)) {
  try {
    stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  } catch (err) {
    console.error('[Migrate] Failed to parse playerStats.json:', err);
    stats = {};
  }
}

module.exports = async function migrateUsernames(guild) {
  if (stats.__usernamesMigrated) {
    console.log('[Migrate] Skipped: Usernames already migrated.');
    return;
  }

  const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
  if (!verifiedRoleId) {
    console.error('[Migrate] VERIFIED_ROLE_ID not set in .env');
    return;
  }

  const members = await guild.members.fetch();
  let updated = 0;

  for (const [id, member] of members) {
    if (!member.roles.cache.has(verifiedRoleId)) continue;

    const raw = member.displayName || member.user.username;
    const cleanName = raw.replace(/^\[\d+\]\s*/, '').split(' ')[0].trim();

    if (!stats[id]) {
      stats[id] = {
        wins: 0,
        losses: 0,
        winstreak: 0,
        mvps: 0,
        bedsBroken: 0,
        prefix: true,
        recentlyPlayed: [],
        lastPlayedAt: 0,
        username: cleanName
      };
      updated++;
    } else if (!stats[id].username) {
      stats[id].username = cleanName;
      updated++;
    }
  }

  stats.__usernamesMigrated = true;

  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
  console.log(`✅ [Migrate] Saved usernames for ${updated} verified players.`);
};
