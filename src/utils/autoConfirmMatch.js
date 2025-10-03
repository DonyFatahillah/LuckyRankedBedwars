const { getActiveGames, deleteActiveGame } = require('../queue/queueManager');
const Player = require('../models/Player');
const { isAllRankQueue } = require('../config/eloQueues');
const { getLogs, updateMatchStatus, editLogEmbed } = require('./matchLogger');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const STAFF_CHANNEL_ID = process.env.STAFF_VERIFY_CHANNEL_ID;
const MATCH_LOGS_ID = process.env.MATCH_LOGS_ID;
const VERIFY_MATCH_CHANNEL_ID = process.env.VERIFY_MATCH_CHANNEL_ID;
const SCORING_CHANNEL_ID = process.env.SCORING_CHANNEL_ID;

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');
function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    return {};
  }
}
function saveStats(data) {
  fs.writeFileSync(STATS_PATH, JSON.stringify(data, null, 2));
}

module.exports = async function autoConfirmMatch(client, guild, gameId, options) {
  const { winner, winBedbreaker, loseBedbreaker, topKiller } = options;

  const activeGames = getActiveGames();
  const match = activeGames.get(gameId);
  if (!match) return;

  const isAllRank = isAllRankQueue(match.voiceChannelId);
  const textChannel = await guild.channels.fetch(match.textChannelId).catch(() => null);
  const scoringChannel = await guild.channels.fetch(SCORING_CHANNEL_ID).catch(() => null);

  const winners = winner === 'team1' ? match.teams[0] : match.teams[1];
  const losers = winner === 'team1' ? match.teams[1] : match.teams[0];

  const allPlayerIds = [...winners, ...losers];
  const members = await Promise.all(
    allPlayerIds.map(pid => guild.members.fetch(pid).catch(() => null))
  );

  const results = [];
  const stats = loadStats();
  const now = new Date().toISOString();

  let mvpDisplayName = topKiller;
  let winBedDisplayName = winBedbreaker;
  let loseBedDisplayName = loseBedbreaker;

  for (const member of members.filter(Boolean)) {
    const player = new Player(member);
    const oldElo = player.elo;

    const isWinner = winners.includes(member.id);
    const isTopKiller = member.user.username.toLowerCase() === topKiller.toLowerCase();
    const isWinBreaker = member.user.username.toLowerCase() === winBedbreaker?.toLowerCase();
    const isLoseBreaker = member.user.username.toLowerCase() === loseBedbreaker?.toLowerCase();

    if (isTopKiller) mvpDisplayName = member.displayName;
    if (isWinBreaker) winBedDisplayName = member.displayName;
    if (isLoseBreaker) loseBedDisplayName = member.displayName;

    if (isWinner) {
      await player.win(isTopKiller, isWinBreaker);
    } else {
      await player.lose(isAllRank ? false : isTopKiller);
    }

    if (isTopKiller) await player.addTopKill();
    if (isWinBreaker || isLoseBreaker) await player.addBedBroken();

    // Update recentlyPlayed
    if (!stats[member.id]) stats[member.id] = {};
    if (!stats[member.id].recentlyPlayed) stats[member.id].recentlyPlayed = [];

    // Prune old > 7d games
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    stats[member.id].recentlyPlayed = stats[member.id].recentlyPlayed.filter(game =>
      new Date(game.playedAt).getTime() > oneWeekAgo
    );

    // Add this game
    stats[member.id].recentlyPlayed.unshift({ id: gameId, playedAt: now });

    // Trim to max 5
    if (stats[member.id].recentlyPlayed.length > 5) {
      stats[member.id].recentlyPlayed = stats[member.id].recentlyPlayed.slice(0, 5);
    }

    await player.save();

    results.push({
      nickname: member.displayName,
      result: isWinner ? '🏆 Win' : '❌ Loss',
      oldElo,
      newElo: player.elo,
    });
  }

  saveStats(stats); // Save after loop

  // 📊 Send ELO Summary
  if (scoringChannel) {
    const winnerLines = results.filter(p => p.result.includes('Win')).map(p => {
      const change = p.newElo - p.oldElo;
      return `🏆 **${p.nickname}** — ELO: \`${p.oldElo}\` ➝ \`${p.newElo}\` (+${change})`;
    }).join('\n');

    const loserLines = results.filter(p => p.result.includes('Loss')).map(p => {
      const change = p.oldElo - p.newElo;
      return `❌ **${p.nickname}** — ELO: \`${p.oldElo}\` ➝ \`${p.newElo}\` (-${change})`;
    }).join('\n');

    await scoringChannel.send({
      content: allPlayerIds.map(id => `<@${id}>`).join(' '),
      embeds: [{
        title: `📊 Game #${gameId} — ELO Summary`,
        description: [
          `⭐ **MVP:** **${mvpDisplayName}**`,
          `🔨 **Winning Bedbreaker:** **${winBedDisplayName}**`,
          loseBedDisplayName ? `🔨 **Losing Bedbreaker:** **${loseBedDisplayName}**` : null,
          `🏅 **Winner:** **${winner.toUpperCase()}**`,
          ``,
          `__**Winning Team:**__\n${winnerLines}`,
          ``,
          `__**Losing Team:**__\n${loserLines}`
        ].filter(Boolean).join('\n'),
        color: 0x3498db,
        timestamp: new Date()
      }]
    }).catch(() => {});
  }

  // Clean up channels
  const category = await guild.channels.fetch(match.categoryId).catch(() => null);
  if (category) {
    const allChannels = await guild.channels.fetch();
    const children = allChannels.filter(c => c.parentId === category.id);
    for (const [, ch] of children) await ch.delete().catch(() => {});
    await category.delete().catch(() => {});
  }

  deleteActiveGame(gameId);
  updateMatchStatus(gameId, 'confirmed', winner);

  const logs = getLogs();
  const confirmedBy = '[AUTO-CONFIRM]';
  const logEntry = logs[gameId];

  const logUpdateOptions = {
    mvp: mvpDisplayName,
    topKiller: mvpDisplayName,
    bedbreaker: winBedDisplayName,
    confirmedBy
  };
  if (loseBedDisplayName) logUpdateOptions.loseBedbreaker = loseBedDisplayName;

  await editLogEmbed(client, guild.id, gameId, STAFF_CHANNEL_ID, 'confirmed', logUpdateOptions);
  await editLogEmbed(client, guild.id, gameId, MATCH_LOGS_ID, 'confirmed', logUpdateOptions);
  await editLogEmbed(client, guild.id, gameId, VERIFY_MATCH_CHANNEL_ID, 'confirmed', logUpdateOptions);

  // Replace original message in staff logs
  if (logEntry?.messageId) {
    const msg = await guild.channels.fetch(STAFF_CHANNEL_ID)
      .then(ch => ch.messages.fetch(logEntry.messageId))
      .catch(() => null);

    if (msg?.content) {
      const updated = msg.content.replace(/📝 \*\*Status:\*\* .*/i, `📝 **Status:** Confirmed\nConfirmed by ${confirmedBy}`);
      await msg.edit({ content: updated }).catch(() => {});
    }
  }
};
