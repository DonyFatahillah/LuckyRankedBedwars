const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const ActiveGame = require('../models/ActiveGame');
const { publishMatch } = require('../utils/redisClient');
const Player = require('../models/Player');
const { logMatch, sendLogToStaffChannel } = require('../utils/matchLogger');
const mapPicker = require('./mapPicker');

/**
 * Starts the map voting process for a match.
 * @param {Guild} guild 
 * @param {TextChannel} channel 
 * @param {Object} game 
 */
async function startMapVoting(guild, channel, game) {
    const maps = mapPicker.getRandomMaps(3);
    const mapButtons = maps.map((m, i) => 
      new ButtonBuilder()
        .setCustomId(`map-vote-${game.gameId}-${i}`)
        .setLabel(m)
        .setStyle(ButtonStyle.Primary)
    );

    const row = new ActionRowBuilder().addComponents(mapButtons);

    const buildVoteEmbed = (currentVoters) => {
      return {
        title: "🗺️ Map Selection",
        description: "Teams are finalized! Now, everyone vote for the map you want to play.\nYou have 20 seconds.",
        fields: [
          { name: "Team 1", value: game.teamA.map(id => game.captainIds && game.captainIds[0] === id ? `<@${id}> (Captain)` : `<@${id}>`).join('\n'), inline: true },
          { name: "Team 2", value: game.teamB.map(id => game.captainIds && game.captainIds[1] === id ? `<@${id}> (Captain)` : `<@${id}>`).join('\n'), inline: true },
          { 
            name: "Maps", 
            value: maps.map((m, i) => {
              const votersForMap = currentVoters[i] || [];
              const voterMentions = votersForMap.length > 0 ? ` (${votersForMap.map(id => `<@${id}>`).join(', ')})` : "";
              return `${i + 1}. **${m}** — ${votersForMap.length} votes${voterMentions}`;
            }).join('\n'), 
            inline: false 
          }
        ],
        color: 0x0099ff
      };
    };

    const mapVoters = maps.map(() => []);
    const voterIds = new Set();

    const voteMsg = await channel.send({ 
      content: game.players.map(id => `<@${id}>`).join(' '), 
      embeds: [buildVoteEmbed(mapVoters)], 
      components: [row] 
    });

    const collector = channel.createMessageComponentCollector({
      filter: i => i.customId.startsWith(`map-vote-${game.gameId}-`) && game.players.includes(i.user.id),
      time: 20000
    });

    collector.on('collect', async i => {
      const mapIndex = parseInt(i.customId.split('-')[3]);
      
      // Remove previous vote if it exists
      mapVoters.forEach((voters, idx) => {
        const foundIdx = voters.indexOf(i.user.id);
        if (foundIdx !== -1) {
          voters.splice(foundIdx, 1);
        }
      });

      // Add new vote
      mapVoters[mapIndex].push(i.user.id);
      
      await i.deferUpdate().catch(() => {});
      await voteMsg.edit({ embeds: [buildVoteEmbed(mapVoters)] }).catch(() => {});
    });

    collector.on('end', async () => {
      const voteCounts = mapVoters.map(v => v.length);
      const maxVotes = Math.max(...voteCounts);
      const winners = maps.filter((_, index) => voteCounts[index] === maxVotes);
      const selectedMap = winners[Math.floor(Math.random() * winners.length)];

      const updatedGame = await ActiveGame.load(game.gameId);
      if (updatedGame) {
        updatedGame.map = selectedMap;
        updatedGame.status = 'pending';
        await updatedGame.save();
        await finalizeMatch(guild, channel, updatedGame);
      }
    });
}

/**
 * Finalizes the match, creates team VCs, and moves players.
 * @param {Guild} guild 
 * @param {TextChannel} channel 
 * @param {Object} game 
 */
async function finalizeMatch(guild, channel, game) {
  try {
    const { getPermissionOverwrites } = require('../queue/queueManager');
    
    const teams = [
      await Promise.all(game.teamA.map(id => guild.members.fetch(id))),
      await Promise.all(game.teamB.map(id => guild.members.fetch(id)))
    ];

    const teamVCTasks = teams.map((team, i) => guild.channels.create({
      name: `#${game.gameId} Team ${i + 1}`,
      type: ChannelType.GuildVoice,
      parent: game.categoryId,
      permissionOverwrites: getPermissionOverwrites(team, PermissionFlagsBits.Connect, false)
    }));

    const createdTeamVCs = await Promise.all(teamVCTasks);
    
    // Reload game to ensure we have latest state before saving VC IDs
    const finalGame = await ActiveGame.load(game.gameId);
    finalGame.voiceAId = createdTeamVCs[0].id;
    finalGame.voiceBId = createdTeamVCs[1].id;
    await finalGame.save();

    const moveTasks = [];
    teams.forEach((team, i) => {
      team.forEach(m => {
        if (m.voice?.channelId) {
          moveTasks.push(m.voice.setChannel(createdTeamVCs[i]).catch(() => {}));
        }
      });
    });
    await Promise.all(moveTasks);

    const waitingRoom = guild.channels.cache.find(c => c.parentId === game.categoryId && (c.name.startsWith('🕒 Waiting Room') || c.name.includes('Waiting Room')));
    if (waitingRoom) await waitingRoom.delete().catch(() => {});

    const teamMentions = teams.map((team, i) => team.map(m => finalGame.captainIds && finalGame.captainIds[i] === m.id ? `<@${m.id}> (Captain)` : `<@${m.id}>`));
    const finalEmbed = {
      title: `Match #${game.gameId} Ready!`,
      description:
        `🗺️ **Map:** ${finalGame.map}\n\n` +
        `👥 **Teams:**\n• **Team 1:** ${teamMentions[0].join(', ')}\n• **Team 2:** ${teamMentions[1].join(', ')}\n\n` +
        `📜 **Match Rules:**\n• Note: Standard rules apply.\n\n` +
        `${finalGame.rules?.rulesEmbed || ''}`,
      color: 0x00ff00
    };

    const messages = await channel.messages.fetch({ limit: 10 });
    const lastBotMsg = messages.find(m => m.author.id === guild.client.user.id && m.embeds.length > 0);
    if (lastBotMsg) {
      await lastBotMsg.edit({ content: `✅ Match #${game.gameId} is starting!`, embeds: [finalEmbed], components: [] });
    } else {
      await channel.send({ content: `✅ Match #${game.gameId} is starting!`, embeds: [finalEmbed] });
    }

    await logMatch(finalGame.gameId, finalGame.teamA, finalGame.teamB, {
      queueType: finalGame.queueType,
      mapName: finalGame.map
    });

    const [teamAData, teamBData] = await Promise.all([
      Promise.all(finalGame.teamA.map(async id => {
        const m = await guild.members.fetch(id);
        const p = await Player.load(m);
        return { id: p.id, ign: p.ingameUsername, elo: p.elo };
      })),
      Promise.all(finalGame.teamB.map(async id => {
        const m = await guild.members.fetch(id);
        const p = await Player.load(m);
        return { id: p.id, ign: p.ingameUsername, elo: p.elo };
      }))
    ]);

    const formattedMap = `w_4_0_${finalGame.map.toLowerCase()}`;
    await publishMatch({
      matchId: finalGame.gameId,
      queueType: finalGame.queueType,
      map: formattedMap,
      teamA: teamAData,
      teamB: teamBData
    });

    if (process.env.MATCH_LOGS_ID) {
      await sendLogToStaffChannel(guild.client, guild.id, finalGame.gameId, process.env.MATCH_LOGS_ID);
    }

  } catch (err) {
    console.error(`[MatchFinalizer] Failed to finalize match:`, err);
    await channel.send({ content: "❌ Failed to finalize match creation. Please contact staff." });
  }
}

module.exports = { startMapVoting, finalizeMatch };
