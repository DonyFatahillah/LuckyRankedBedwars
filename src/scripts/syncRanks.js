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
  console.log(`[Rank Sync] Processing ${members.size} total members...`);

  // Load ELO data from MongoDB to have a quick lookup
  const playerMap = new Map();
  try {
    const dbPlayers = await PlayerModel.find({}, 'userId elo').lean();
    dbPlayers.forEach(p => playerMap.set(p.userId, p.elo));
  } catch (err) {
    console.error('[Rank Sync] Failed to fetch players from MongoDB:', err);
  }

  const updatedRoles = [];
  const updatedNicks = [];
  let processedCount = 0;

  for (const [userId, member] of members) {
    if (member.user.bot) continue;
    
    // Only sync verified users
    if (!member.roles.cache.has(verifiedRoleId)) continue;

    processedCount++;
    const elo = playerMap.has(userId) ? playerMap.get(userId) : 0;

    // 1. Update Rank Roles
    try {
      const correctRank = getRankByElo(elo);
      if (correctRank && correctRank.roleId) {
        if (!member.roles.cache.has(correctRank.roleId)) {
          await updateRankRoles(member, elo);
          updatedRoles.push(userId);
        }
      }
    } catch (err) {
      console.error(`[Rank Sync] Role error for ${userId}:`, err.message);
    }

    // 2. Force Nickname Update (ELO Prefix)
    try {
      // Load player (this handles defaults if not in DB)
      const player = await Player.load(member);
      
      // Ensure the elo in the player object matches our lookup (important if DB was just reset)
      player.elo = elo; 

      const oldNick = member.nickname || member.user.username;
      
      // setNickname internally uses player.elo to build the [ELO] prefix
      await player.setNickname();
      
      const newNick = member.nickname || member.user.username;
      if (oldNick !== newNick) {
        updatedNicks.push(userId);
      }
    } catch (err) {
      console.error(`[Rank Sync] Nickname error for ${userId}:`, err.message);
    }
  }

  console.log(`✅ [Rank Sync] Processed ${processedCount} verified members.`);
  console.log(`✅ [Rank Sync] Updated ${updatedRoles.length} roles and ${updatedNicks.length} nicknames.`);
};
