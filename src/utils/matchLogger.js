const { EmbedBuilder } = require('discord.js');
const { redis } = require('./redisClient');
const MatchLogModel = require('../models/MatchLogSchema');

// ✅ Load logs from MongoDB and cache in Redis
async function loadLogs() {
  try {
    const logsFromDb = await MatchLogModel.find({}).lean();
    for (const log of logsFromDb) {
      await redis.set(`match:${log.matchId}`, JSON.stringify(log));
    }
    console.log(`[MatchLogger] Loaded ${logsFromDb.length} logs from MongoDB to Redis.`);
  } catch (err) {
    console.error('[MatchLogger] Failed to load from Mongo:', err);
  }
}

// ✅ Save log to Redis + MongoDB
async function saveLogs(gameId) {
  const raw = await redis.get(`match:${gameId}`);
  if (!raw) return;
  const log = JSON.parse(raw);

  try {
    await MatchLogModel.findOneAndUpdate(
      { matchId: gameId },
      {
        matchId: gameId,
        timestamp: new Date(log.createdAt).getTime(),
        queueType: log.queueType || 'Unknown',
        winners: log.winners || [],
        losers: log.losers || [],
        mvp: log.topKiller || null,
        bedbreaker: log.bedbreaker || null,
        status: log.status || 'pending',
        mapName: log.mapName || 'Unknown'
      },
      { upsert: true }
    );
  } catch (err) {
    console.error(`[MatchLogger-Mongo] Failed to save match #${gameId}:`, err);
  }
}

async function getMatchLog(gameId) {
  // 1. Try Redis first
  const raw = await redis.get(`match:${gameId}`);
  if (raw) return JSON.parse(raw);

  // 2. Fallback to MongoDB
  try {
    const log = await MatchLogModel.findOne({ matchId: gameId }).lean();
    if (log) {
      // Re-map Mongo fields to the format expected by the app if necessary
      // Based on logMatch() structure: team1, team2, queueType, mapName, status, createdAt
      const formattedLog = {
        gameId: log.matchId,
        team1: log.team1 || log.winners || [], // Use winners/losers if team1/team2 not explicitly stored
        team2: log.team2 || log.losers || [],
        queueType: log.queueType,
        mapName: log.mapName,
        status: log.status,
        createdAt: new Date(log.timestamp).toISOString(),
        ...log
      };
      
      // Cache back to Redis
      await redis.set(`match:${gameId}`, JSON.stringify(formattedLog));
      return formattedLog;
    }
  } catch (err) {
    console.error(`[MatchLogger] Mongo lookup failed for #${gameId}:`, err);
  }

  return null;
}

async function logMatch(gameId, team1, team2, options = {}) {
  const log = {
    gameId,
    team1,
    team2,
    queueType: options.queueType || 'Unknown',
    mapName: options.mapName || 'Unknown',
    status: 'pending',
    createdAt: new Date().toISOString(),
    messageIds: {},
  };
  await redis.set(`match:${gameId}`, JSON.stringify(log));
  await saveLogs(gameId);
}

async function updateMatchStatus(gameId, status, winner = null) {
  const log = await getMatchLog(gameId);
  if (!log) return;

  log.status = status;
  log.winner = winner;
  log.winners = winner === 'team1' ? log.team1 : (winner === 'team2' ? log.team2 : []);
  log.losers = winner === 'team1' ? log.team2 : (winner === 'team2' ? log.team1 : []);
  
  await redis.set(`match:${gameId}`, JSON.stringify(log));
  await saveLogs(gameId);
}

async function updateMatchDetails(gameId, details = {}) {
  const log = await getMatchLog(gameId);
  if (!log) return;

  Object.assign(log, details);
  await redis.set(`match:${gameId}`, JSON.stringify(log));
  await saveLogs(gameId);
}

// ✅ Send log embed
async function sendLogToStaffChannel(client, guildId, gameId, channelIds, bedbreaker = null) {
  const guild = await client.guilds.fetch(guildId);
  const log = await getMatchLog(gameId);
  if (!log) return;

  const team1 = log.team1.map(id => `<@${id}>`).join(', ') || 'N/A';
  const team2 = log.team2.map(id => `<@${id}>`).join(', ') || 'N/A';
  const status = log.status || 'pending';

  let statusField = `\`${status.toUpperCase()}\``;
  if (status === 'confirmed' && log.winner) {
    const winningTeam = log.winner === 'team1' ? 'Team 1' : 'Team 2';
    statusField += `\n🏆 **Winner:** ${winningTeam}`;
  } else if (status === 'void') {
    statusField = '`VOID` ❌';
  }

  const embed = new EmbedBuilder()
    .setTitle(`📘 Match Log — #${gameId}`)
    .addFields(
      { name: 'Team 1', value: team1, inline: false },
      { name: 'Team 2', value: team2, inline: false },
      { name: 'Status', value: statusField, inline: false }
    )
    .setColor(status === 'confirmed' ? 0x00ff00 : status === 'void' ? 0xff0000 : 0xffa500)
    .setTimestamp();

  if (bedbreaker) embed.addFields({ name: '🔨 Bedbreaker', value: bedbreaker, inline: false });
  if (log.topKiller && log.kills !== undefined) {
    embed.addFields({ name: '⚔️ Top Killer', value: `${log.topKiller} (${log.kills} kills)`, inline: false });
  }

  const channels = Array.isArray(channelIds) ? channelIds : [channelIds];
  for (const channelId of channels) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;

    const oldMsgId = log.messageIds?.[channelId];
    if (oldMsgId) {
      const oldMsg = await channel.messages.fetch(oldMsgId).catch(() => null);
      if (oldMsg) {
        await oldMsg.delete().catch(() => {});
        delete log.messageIds[channelId];
      }
    }

    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (status === 'pending' && sent) {
      if (!log.messageIds) log.messageIds = {};
      log.messageIds[channelId] = sent.id;
    }
  }

  await redis.set(`match:${gameId}`, JSON.stringify(log));
  await saveLogs(gameId);
}

async function editLogEmbed(client, guildId, gameId, channelId, status, options = {}) {
  const log = await getMatchLog(gameId);
  if (!log || !log.messageIds?.[channelId]) return;

  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const message = await channel.messages.fetch(log.messageIds[channelId]).catch(() => null);
  if (!message) return;

  const embed = new EmbedBuilder()
    .setTitle(status === 'confirmed' ? `✅ Match #${gameId} Confirmed` : status === 'void' ? `❌ Match #${gameId} Voided` : `📘 Match Log — #${gameId}`)
    .addFields(
      { name: 'Team 1', value: log.team1.map(id => `<@${id}>`).join(', '), inline: false },
      { name: 'Team 2', value: log.team2.map(id => `<@${id}>`).join(', '), inline: false }
    )
    .setColor(status === 'confirmed' ? 0x00ff00 : status === 'void' ? 0xff0000 : 0xffa500)
    .setTimestamp()
    .setFooter({ text: `Status: ${status.toUpperCase()}` });

  if (status === 'confirmed' && log.winner) embed.addFields({ name: '🏆 Winner', value: log.winner === 'team1' ? 'Team 1' : 'Team 2', inline: false });
  if (options.mvp) embed.addFields({ name: '🎖️ MVP', value: options.mvp, inline: true });
  if (options.topKiller) embed.addFields({ name: '⚔️ Top Killer', value: options.topKiller, inline: true });
  if (options.bedbreaker) embed.addFields({ name: '🔨 Winning Bedbreaker', value: options.bedbreaker, inline: true });
  if (options.loseBedbreaker && options.loseBedbreaker !== 'null') embed.addFields({ name: '🔨 Losing Bedbreaker', value: options.loseBedbreaker, inline: true });
  if (options.confirmedBy) embed.addFields({ name: '✅ Confirmed By', value: options.confirmedBy, inline: false });

  await message.edit({ embeds: [embed] });
}

async function getLogs() {
  try {
    const keys = await redis.keys('match:*');
    if (keys.length === 0) return {};

    const values = await redis.mget(keys);
    const logs = {};

    keys.forEach((key, i) => {
      if (values[i]) {
        const gameId = key.split(':')[1];
        logs[gameId] = JSON.parse(values[i]);
      }
    });

    return logs;
  } catch (err) {
    console.error('[MatchLogger] Failed to get all logs from Redis:', err);
    return {};
  }
}

module.exports = { loadLogs, saveLogs, getMatchLog, getLogs, logMatch, updateMatchStatus, updateMatchDetails, sendLogToStaffChannel, editLogEmbed };
