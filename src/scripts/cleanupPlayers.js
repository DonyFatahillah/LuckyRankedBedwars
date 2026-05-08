// src/scripts/cleanupPlayers.js
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Player = require('../models/Player');
const { RANKS } = require('../utils/EloRank');

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');
const ELO_PATH = path.join(__dirname, '../../data/elo.json');

module.exports = async function runCleanup(client, membersArg = null) {
  const guildId = process.env.GUILD_ID;
  const verifiedRoleId = process.env.VERIFIED_ROLE_ID;

  if (!guildId || !verifiedRoleId) {
    console.error('[Cleanup] Missing GUILD_ID or VERIFIED_ROLE_ID in .env');
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error('[Cleanup] Failed to fetch guild');
    return;
  }

  const members = membersArg || await guild.members.fetch();

  let playerStats = {};
  let eloData = {};

  if (fs.existsSync(STATS_PATH)) {
    try {
      playerStats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
    } catch (err) {
      console.error('[Cleanup] Failed to parse playerStats.json:', err);
    }
  }

  if (fs.existsSync(ELO_PATH)) {
    try {
      eloData = JSON.parse(fs.readFileSync(ELO_PATH, 'utf-8'));
    } catch (err) {
      console.error('[Cleanup] Failed to parse elo.json:', err);
    }
  }

  const allUserIds = new Set([
    ...Object.keys(playerStats),
    ...Object.keys(eloData),
  ]);

  const removed = {
    notInServer: [],
    notVerified: [],
  };

  for (const userId of allUserIds) {
    const member = members.get(userId);

    // ❌ Not in server
    if (!member) {
      delete playerStats[userId];
      delete eloData[userId];
      removed.notInServer.push(userId);
      continue;
    }

    const hasVerifiedRole = member.roles.cache.has(verifiedRoleId);

    // ❌ In server but not verified
    if (!hasVerifiedRole) {
      // Remove data
      if (userId in playerStats) delete playerStats[userId];
      if (userId in eloData) delete eloData[userId];
      removed.notVerified.push(userId);

      // Remove any division roles they may have
      const rankRoleIds = RANKS.map(r => r.roleId);
      const rolesToRemove = rankRoleIds.filter(id => member.roles.cache.has(id));

      if (rolesToRemove.length > 0) {
        await member.roles.remove(rolesToRemove).catch(() => {});
      }

      // Reset nickname if it has a prefix like [1234] xyz or ends in #0
      const currentNick = member.nickname || member.user.username;
      const needsReset = /^\[\d+\]/.test(currentNick) || currentNick.endsWith('#0');

      if (needsReset) {
        const fallback = member.user.discriminator === '0'
          ? member.user.username
          : `${member.user.username}#${member.user.discriminator}`;

        await member.setNickname(fallback).catch(() => {});
      }

      console.log(`🧹 Removed unverified user: ${member.user.tag} (${userId})`);
    }
  }

  // Save changes
  fs.writeFileSync(STATS_PATH, JSON.stringify(playerStats, null, 2));
  fs.writeFileSync(ELO_PATH, JSON.stringify(eloData, null, 2));

  console.log(`🧹 [Cleanup] Removed ${removed.notInServer.length} users not in server.`);
  console.log(`🧹 [Cleanup] Removed ${removed.notVerified.length} unverified users.`);
};
