// src/scripts/syncRanks.js
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getRankByElo, updateRankRoles } = require('../utils/EloRank');
const PlayerModel = require('../models/PlayerSchema');

module.exports = async function runRankSync(client, membersArg = null) {
  const guildId = process.env.GUILD_ID;
  const verifiedRoleId = process.env.VERIFIED_ROLE_ID || '1401289452633985086';
  if (!guildId) {
    console.error('[Rank Sync] Missing GUILD_ID in .env');
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error('[Rank Sync] Failed to fetch guild');
    return;
  }

  // Ensure members are fetched or use provided ones
  const members = membersArg || await guild.members.fetch();

  // Load ELO data from MongoDB
  let players = [];
  try {
    players = await PlayerModel.find({}, 'userId elo').lean();
  } catch (err) {
    console.error('[Rank Sync] Failed to fetch players from MongoDB:', err);
    return;
  }

  const updated = [];
  const skipped = [];

  for (const player of players) {
    const { userId, elo } = player;
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
