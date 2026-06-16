// src/scripts/syncRanks.js
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getRankByElo, updateRankRoles } = require('../utils/EloRank');
const PlayerModel = require('../models/PlayerSchema');
const Player = require('../models/Player');

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

  const updatedRoles = [];
  const updatedNicks = [];
  const skipped = [];

  for (const playerData of players) {
    const { userId, elo } = playerData;
    const member = members.get(userId);

    if (!member) {
      skipped.push({ userId, reason: 'Not in server' });
      continue;
    }

    if (!member.roles.cache.has(verifiedRoleId)) {
      skipped.push({ userId, reason: 'Not verified' });
      continue;
    }

    // 1. Update Rank Roles
    const correctRank = getRankByElo(elo);
    if (correctRank && correctRank.roleId) {
      if (!member.roles.cache.has(correctRank.roleId)) {
        await updateRankRoles(member, elo);
        updatedRoles.push(userId);
      }
    }

    // 2. Update Nickname (ELO Prefix)
    try {
      const player = await Player.load(member);
      const oldNick = member.nickname || member.user.username;
      
      // We call setNickname to force the correct [ELO] prefix
      await player.setNickname();
      
      const newNick = member.nickname || member.user.username;
      if (oldNick !== newNick) {
        updatedNicks.push(userId);
      }
    } catch (err) {
      console.error(`[Rank Sync] Failed to update nickname for ${userId}:`, err.message);
    }
  }

  console.log(`✅ [Rank Sync] Updated ${updatedRoles.length} rank roles and ${updatedNicks.length} nicknames.`);
  if (skipped.length > 0) {
    console.log(`⚠️ [Rank Sync] Skipped ${skipped.length} members (not in server or not verified).`);
  }
};
