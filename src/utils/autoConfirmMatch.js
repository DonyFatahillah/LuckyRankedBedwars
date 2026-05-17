const { getActiveGames, deleteActiveGame } = require('../queue/queueManager');
const Player = require('../models/Player');
const { isAllRankQueue } = require('../config/eloQueues');
const { getLogs, updateMatchStatus, editLogEmbed } = require('./matchLogger');
require('dotenv').config();

const STAFF_CHANNEL_ID = process.env.STAFF_VERIFY_CHANNEL_ID;
const MATCH_LOGS_ID = process.env.MATCH_LOGS_ID;
const VERIFY_MATCH_CHANNEL_ID = process.env.VERIFY_MATCH_CHANNEL_ID;
const SCORING_CHANNEL_ID = process.env.SCORING_CHANNEL_ID;

module.exports = async function autoConfirmMatch(client, guild, gameId, options) {
  gameId = String(gameId).toUpperCase();
  const { winner, winBedbreaker, loseBedbreaker, topKiller } = options;

  const activeGames = await getActiveGames();
  const match = activeGames.find(g => g.gameId === gameId);
  if (!match) {
    console.warn(`[autoConfirmMatch] No active match found with ID ${gameId}`);
    return;
  }

  console.log(`[autoConfirmMatch] Processing game ${gameId}`);
  
  // Normalize team data to match the expected format
  const teams = [match.teamA, match.teamB];
  if (!teams[0] || !teams[1]) {
    console.error(`[autoConfirmMatch] Match ${gameId} is missing team data. TeamA:`, match.teamA, "TeamB:", match.teamB);
    return;
  }

  const isAllRank = isAllRankQueue(match.voiceChannelId);
  const scoringChannel = await guild.channels.fetch(SCORING_CHANNEL_ID).catch(() => null);
  const allPlayerIds = [...teams[0], ...teams[1]];
  
  // Fetch members
  const memberMap = new Map();
  for (const id of allPlayerIds) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (member) memberMap.set(id, member);
  }

  // --- Determine winner from bedbreaker if needed ---
  let winnerTeam = winner;
  if (!winnerTeam && winBedbreaker) {
    let bedbreakerPlayerId = null;
    for (const id of allPlayerIds) {
      const m = memberMap.get(id);
      if (!m) continue;
      const player = await Player.load(m);
      if (player.username.toLowerCase() === winBedbreaker.toLowerCase()) {
        bedbreakerPlayerId = id;
        break;
      }
    }

    if (bedbreakerPlayerId) {
      winnerTeam = teams[0].includes(bedbreakerPlayerId) ? 'team1' : 'team2';
    } else {
      console.warn(`[AutoConfirm] WinBedbreaker ${winBedbreaker} not found in either team for ${gameId}`);
      winnerTeam = 'team1'; // fallback
    }
  }

  const winners = winnerTeam === 'team1' ? teams[0] : teams[1];
  const losers = winnerTeam === 'team1' ? teams[1] : teams[0];

  // --- ELO and stat updates ---
  const results = [];
  let mvpUsername = topKiller;
  let winBedUsername = winBedbreaker;
  let loseBedUsername = loseBedbreaker;

  for (const id of allPlayerIds) {
    const member = memberMap.get(id);
    if (!member) continue;

    try {
      const player = await Player.load(member);
      const oldElo = player.elo;

      const isWinner = winners.includes(id);
      const uname = player.username.toLowerCase();

      const isTopKiller = uname === topKiller?.toLowerCase();
      const isWinBreaker = uname === winBedbreaker?.toLowerCase();
      const isLoseBreaker = loseBedbreaker && uname === loseBedbreaker?.toLowerCase();

      if (isTopKiller) mvpUsername = player.username;
      if (isWinBreaker) winBedUsername = player.username;
      if (isLoseBreaker) loseBedUsername = player.username;

      if (isWinner) {
        await player.win(gameId, isTopKiller, isWinBreaker);
      } else {
        await player.lose(gameId, isAllRank ? false : isTopKiller);
      }

      if (isTopKiller) await player.addTopKill();
      if (isWinBreaker || isLoseBreaker) await player.addBedBroken();

      await player.addRecentGame(gameId);
      await player.save();

      results.push({
        username: player.username,
        result: isWinner ? '🏆 Win' : '❌ Loss',
        oldElo,
        newElo: player.elo
      });
    } catch (err) {
      console.error(`[autoConfirmMatch] Error processing ${id}: ${err.stack}`);
    }
  }

  // --- Scoring summary embed ---
  if (scoringChannel) {
    try {
      const winnerLines = results
        .filter(p => p.result.includes('Win'))
        .map(p => {
          const change = p.newElo - p.oldElo;
          return `🏆 **${p.username}** — ELO: \`${p.oldElo}\` ➝ \`${p.newElo}\` (+${change})`;
        }).join('\n');

      const loserLines = results
        .filter(p => p.result.includes('Loss'))
        .map(p => {
          const change = p.oldElo - p.newElo;
          return `❌ **${p.username}** — ELO: \`${p.oldElo}\` ➝ \`${p.newElo}\` (-${change})`;
        }).join('\n');

      await scoringChannel.send({
        content: allPlayerIds.map(id => `<@${id}>`).join(' '),
        embeds: [{
          title: `📊 Game #${gameId} — ELO Summary`,
          description: [
            `⭐ **MVP:** **${mvpUsername}**`,
            `🔨 **Winning Bedbreaker:** **${winBedUsername}**`,
            loseBedUsername && loseBedUsername !== 'null' ? `🔨 **Losing Bedbreaker:** **${loseBedUsername}**` : null,
            `🏅 **Winner:** **${winnerTeam.toUpperCase()}**`,
            ``,
            `__**Winning Team:**__\n${winnerLines}`,
            ``,
            `__**Losing Team:**__\n${loserLines}`
          ].filter(Boolean).join('\n'),
          color: 0x3498db,
          timestamp: new Date()
        }]
      });
    } catch (err) {
      console.error(`[autoConfirmMatch] Failed to send scoring summary: ${err.message}`);
    }
  }

  // --- Cleanup match channels ---
  try {
    const category = await guild.channels.fetch(match.categoryId).catch(() => null);
    if (category) {
      const waitingRoomId = process.env.WAITING_ROOM_VOICE_ID;
      const waitingRoom = waitingRoomId ? await guild.channels.fetch(waitingRoomId).catch(() => null) : null;

      const children = category.children.cache;
      
      // Move any players left in voice channels to waiting room
      const voiceChannels = children.filter(c => c.type === 2); // 2 is GuildVoice
      for (const [, vc] of voiceChannels) {
        if (waitingRoom) {
          await Promise.all(vc.members.map(m => m.voice.setChannel(waitingRoom).catch(() => {})));
        }
      }

      // Small delay to ensure moves are processed before deletion
      await new Promise(resolve => setTimeout(resolve, 1000));

      for (const [, ch] of children) await ch.delete().catch(() => {});
      await category.delete().catch(() => {});
    }
  } catch (err) {
    console.error(`[autoConfirmMatch] Cleanup error: ${err.message}`);
  }

  // --- Update logs and match state ---
  try {
    deleteActiveGame(gameId);
    updateMatchStatus(gameId, 'confirmed', winnerTeam);
  } catch (err) {
    console.error(`[autoConfirmMatch] Failed to delete/update match: ${err.stack}`);
  }

  const logs = getLogs();
  const logEntry = logs[gameId];
  const confirmedBy = '[AUTO-CONFIRM]';
  const logUpdateOptions = {
    mvp: mvpUsername,
    topKiller: mvpUsername,
    bedbreaker: winBedUsername,
    confirmedBy
  };
  if (loseBedUsername) logUpdateOptions.loseBedbreaker = loseBedUsername;

  for (const channelId of [STAFF_CHANNEL_ID, MATCH_LOGS_ID, VERIFY_MATCH_CHANNEL_ID]) {
    try {
      await editLogEmbed(client, guild.id, gameId, channelId, 'confirmed', logUpdateOptions);
    } catch (err) {
      console.warn(`[autoConfirmMatch] Failed to edit embed in ${channelId}: ${err.message}`);
    }
  }

  // --- Update legacy match message text (if any) ---
  if (logEntry?.messageId) {
    try {
      const msg = await guild.channels.fetch(STAFF_CHANNEL_ID)
        .then(ch => ch.messages.fetch(logEntry.messageId));
      if (msg?.content) {
        const updated = msg.content.replace(
          /📝 \*\*Status:\*\* .*/i,
          `📝 **Status:** Confirmed\nConfirmed by ${confirmedBy}`
        );
        await msg.edit({ content: updated });
      }
    } catch {}
  }

  console.log(`[autoConfirmMatch] ✅ Game ${gameId} auto-confirmed successfully`);
};
