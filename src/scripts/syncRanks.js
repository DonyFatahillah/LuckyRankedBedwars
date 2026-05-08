// src/scripts/syncRanks.js
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getRankByElo, updateRankRoles } = require('../utils/EloRank');
const ELO_PATH = path.join(__dirname, '../../data/elo.json');

module.exports = async function runRankSync(client, membersArg = null) {
  const guildId = process.env.GUILD_ID;
  const verifiedRoleId = process.env.VERIFIED_ROLE_ID;

  if (!guildId || !verifiedRoleId) {
    console.error('[Rank Sync] Missing GUILD_ID or VERIFIED_ROLE_ID in .env');
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error('[Rank Sync] Failed to fetch guild');
    return;
  }

  // Ensure members are fetched or use provided ones
  const members = membersArg || await guild.members.fetch();

  // Load ELO data
  let eloData = {};
  if (fs.existsSync(ELO_PATH)) {
    try {
      eloData = JSON.parse(fs.readFileSync(ELO_PATH, 'utf-8'));
    } catch (err) {
      console.error('[Rank Sync] Failed to read elo.json:', err);
      return;
    }
  }

  const updated = [];
  const skipped = [];

  // Use the cached members collection instead of individual fetch calls
  for (const [userId, elo] of Object.entries(eloData)) {
    const member = members.get(userId);

    if (!member) {
      skipped.push({ userId, reason: 'Not in server' });
      continue;
    }

    if (!member.roles.cache.has(verifiedRoleId)) {
      skipped.push({ userId, reason: 'Not verified' });
      continue;
    }

    const correctRank = getRankByElo(elo);
    if (!correctRank || !correctRank.roleId) {
      skipped.push({ userId, reason: 'No rank mapping' });
      continue;
    }

    if (member.roles.cache.has(correctRank.roleId)) continue;

    await updateRankRoles(member, elo);
    updated.push({ userId, rank: correctRank.name, elo });
  }

  console.log(`✅ [Rank Sync] Updated ${updated.length} members' rank roles.`);
  if (skipped.length > 0) {
    console.log(`⚠️ [Rank Sync] Skipped ${skipped.length} members:`);
    skipped.forEach(s => console.log(`  - ${s.userId}: ${s.reason}`));
  }
};
