const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const MATCH_LOGS_PATH = path.join(__dirname, '../../data/matchLogs.json');

// ✅ Singleton logs object (in-memory cache)
let logs = {};

// ✅ Load once into memory
function loadLogs() {
  if (fs.existsSync(MATCH_LOGS_PATH)) {
    const raw = fs.readFileSync(MATCH_LOGS_PATH);
    const data = JSON.parse(raw);

    logs = Array.isArray(data)
      ? Object.fromEntries(data
          .filter(e => e && e.gameId)
          .map(e => [e.gameId, {
            ...e,
            messageIds: {}, // fallback for older data
          }])
        )
      : data;

    console.log(`[MatchLogger] Loaded ${Object.keys(logs).length} logs.`);
  } else {
    logs = {};
  }
}

// ✅ Save logs to disk
function saveLogs() {
  fs.writeFileSync(MATCH_LOGS_PATH, JSON.stringify(logs, null, 2));
}

// ✅ Get current logs (for use in other modules)
function getLogs() {
  return logs;
}

// ✅ Create a new match log
function logMatch(gameId, team1, team2) {
  loadLogs();
  logs[gameId] = {
    gameId,
    team1,
    team2,
    status: 'pending',
    createdAt: new Date().toISOString(),
    messageId: null, // legacy
    messageIds: {}, // new: per-channel messages
  };
  saveLogs();
}

// ✅ Update status + winner
function updateMatchStatus(gameId, status, winner = null) {
  loadLogs();
  if (!logs[gameId]) {
    console.warn(`[updateMatchStatus] No match log found for ID ${gameId}`);
    return;
  }

  logs[gameId].status = status;
  logs[gameId].winner = winner;
  saveLogs();
}

// ✅ Update MVP, kills, etc.
function updateMatchDetails(gameId, details = {}) {
  if (!logs[gameId]) {
    console.warn(`[updateMatchDetails] No match log found for ID ${gameId}`);
    return;
  }

  Object.assign(logs[gameId], details);
  saveLogs();
}

// ✅ Send log embed to 1 or multiple channels (and track message ID per channel)
async function sendLogToStaffChannel(client, guildId, gameId, channelIds, bedbreaker = null) {
  loadLogs();
  const guild = await client.guilds.fetch(guildId);
  const log = logs[gameId];
  if (!log) {
    console.warn(`[sendLogToStaffChannel] No log found for match #${gameId}`);
    return;
  }

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

  if (bedbreaker) {
    embed.addFields({ name: '🔨 Bedbreaker', value: bedbreaker, inline: false });
  }

  if (log.topKiller && log.kills !== undefined) {
    embed.addFields({
      name: '⚔️ Top Killer',
      value: `${log.topKiller} (${log.kills} kills)`,
      inline: false
    });
  }

  const channels = Array.isArray(channelIds) ? channelIds : [channelIds];
  if (!log.messageIds) log.messageIds = {};

  for (const channelId of channels) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;

    // ✅ Delete old embed if status is not pending
    const oldMsgId = log.messageIds[channelId];
    if (oldMsgId) {
      const oldMsg = await channel.messages.fetch(oldMsgId).catch(() => null);
      if (oldMsg) {
        await oldMsg.delete().catch(() => {});
        delete log.messageIds[channelId];
      }
    }

    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (status === 'pending' && sent) {
      log.messageIds[channelId] = sent.id;
    }
  }

  saveLogs();
}

// ✅ Edit existing log embed (per-channel safe)
async function editLogEmbed(client, guildId, gameId, channelId, status, options = {}) {
  loadLogs();
  const log = logs[gameId];
  if (!log || !log.messageIds || !log.messageIds[channelId]) return;

  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const message = await channel.messages.fetch(log.messageIds[channelId]).catch(() => null);
  if (!message) return;

  const team1 = log.team1.map(id => `<@${id}>`).join(', ') || 'N/A';
  const team2 = log.team2.map(id => `<@${id}>`).join(', ') || 'N/A';

  const embed = new EmbedBuilder()
    .setTitle(
      status === 'confirmed'
        ? `✅ Match #${gameId} Confirmed`
        : status === 'void'
        ? `❌ Match #${gameId} Voided`
        : `📘 Match Log — #${gameId}`
    )
    .addFields(
      { name: 'Team 1', value: team1, inline: false },
      { name: 'Team 2', value: team2, inline: false }
    )
    .setColor(status === 'confirmed' ? 0x00ff00 : status === 'void' ? 0xff0000 : 0xffa500)
    .setTimestamp()
    .setFooter({ text: `Status: ${status.toUpperCase()}` });

  if (status === 'confirmed' && log.winner) {
    const winningTeam = log.winner === 'team1' ? 'Team 1' : 'Team 2';
    embed.addFields({ name: '🏆 Winner', value: winningTeam, inline: false });
  }

  if (options.mvp) {
    embed.addFields({ name: '🎖️ MVP', value: options.mvp, inline: true });
  }

  if (options.topKiller) {
    embed.addFields({ name: '⚔️ Top Killer', value: options.topKiller, inline: true });
  }

if (options.bedbreaker) {
  embed.addFields({ name: '🔨 Winning Bedbreaker', value: options.bedbreaker, inline: true });
}
if (options.loseBedbreaker) {
  embed.addFields({ name: '🔨 Losing Bedbreaker', value: options.loseBedbreaker, inline: true });
}

  if (options.confirmedBy) {
    embed.addFields({ name: '✅ Confirmed By', value: options.confirmedBy, inline: false });
  }

  await message.edit({ embeds: [embed] });
}

module.exports = {
  loadLogs,
  saveLogs,
  getLogs,
  logMatch,
  updateMatchStatus,
  updateMatchDetails,
  sendLogToStaffChannel,
  editLogEmbed
};
