const { Events, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const ActiveGame = require('../models/ActiveGame');
const { publishMatch } = require('../utils/redisClient');
const Player = require('../models/Player');
const { logMatch, sendLogToStaffChannel } = require('../utils/matchLogger');
const { getActiveGames } = require('../queue/queueManager');
const mapPicker = require('../utils/mapPicker');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
    
    const isSelect = interaction.isStringSelectMenu();
    const isBtn = interaction.isButton();

    if (isSelect && interaction.customId.startsWith('picking-select-')) {
      await handlePicking(interaction);
    } else if (isBtn && interaction.customId.startsWith('map-vote-')) {
      await handleMapVote(interaction);
    }
  }
};

async function handlePicking(interaction) {
  const gameId = interaction.customId.split('-')[2];
  const { guild, channel, user } = interaction;

  const allGames = await getActiveGames();
  const gameData = allGames.find(g => g.gameId === gameId);

  if (!gameData || !gameData.pickingPhase) {
    return interaction.reply({ content: "❌ This picking phase is no longer active.", ephemeral: true });
  }

  const game = new ActiveGame(gameData);

  if (game.pickingTurn !== user.id) {
    return interaction.reply({ content: "❌ It is not your turn to pick!", ephemeral: true });
  }

  const pickedUserId = interaction.values[0];
  if (!game.unpickedPlayers.includes(pickedUserId)) {
    return interaction.reply({ content: "❌ That player is no longer available.", ephemeral: true });
  }

  const isTeamA = game.captainIds[0] === user.id;
  if (isTeamA) {
    game.teamA.push(pickedUserId);
  } else {
    game.teamB.push(pickedUserId);
  }

  game.unpickedPlayers = game.unpickedPlayers.filter(id => id !== pickedUserId);

  if (game.unpickedPlayers.length > 0) {
    game.pickingTurn = isTeamA ? game.captainIds[1] : game.captainIds[0];
    await game.save();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`picking-select-${gameId}`)
      .setPlaceholder('Select a player to pick')
      .addOptions(await Promise.all(game.unpickedPlayers.map(async id => {
        const m = await guild.members.fetch(id).catch(() => null);
        return {
          label: m ? (m.displayName || m.user.username) : id,
          value: id
        };
      })));

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const pickingEmbed = {
      title: "🎮 Picking Phase",
      description: `Captain <@${user.id}> picked <@${pickedUserId}>!\n\nIt is now <@${game.pickingTurn}>'s turn to pick.`,
      fields: [
        { name: "Pool", value: game.unpickedPlayers.map(id => `<@${id}>`).join('\n') || "None", inline: true },
        { name: "Team 1", value: game.teamA.map(id => `<@${id}>`).join('\n'), inline: true },
        { name: "Team 2", value: game.teamB.map(id => `<@${id}>`).join('\n'), inline: true }
      ],
      color: 0xffff00
    };

    return interaction.update({ embeds: [pickingEmbed], components: [row] });
  } else {
    // Picking Finished!
    game.pickingPhase = false;
    game.pickingTurn = null;
    game.status = 'voting'; // New status for map voting
    await game.save();

    // Trigger Map Voting
    const maps = mapPicker.getRandomMaps(3);
    const mapButtons = maps.map((m, i) => 
      new ButtonBuilder()
        .setCustomId(`map-vote-${gameId}-${i}`)
        .setLabel(m)
        .setStyle(ButtonStyle.Primary)
    );

    const row = new ActionRowBuilder().addComponents(mapButtons);

    const voteEmbed = {
      title: "🗺️ Map Selection",
      description: "Teams are finalized! Now, everyone vote for the map you want to play.\nYou have 20 seconds.",
      fields: [
        { name: "Team 1", value: game.teamA.map(id => `<@${id}>`).join('\n'), inline: true },
        { name: "Team 2", value: game.teamB.map(id => `<@${id}>`).join('\n'), inline: true },
        { name: "Maps", value: maps.map((m, i) => `${i + 1}. **${m}**`).join('\n'), inline: false }
      ],
      color: 0x0099ff
    };

    await interaction.update({ content: null, embeds: [voteEmbed], components: [row] });

    // Store maps in memory for this collector session
    const votes = new Array(maps.length).fill(0);
    const voterIds = new Set();

    const collector = channel.createMessageComponentCollector({
      filter: i => i.customId.startsWith(`map-vote-${gameId}-`) && game.players.includes(i.user.id),
      time: 20000
    });

    collector.on('collect', async i => {
      if (voterIds.has(i.user.id)) {
        return i.reply({ content: "❌ You have already voted!", ephemeral: true });
      }
      voterIds.add(i.user.id);
      const mapIndex = parseInt(i.customId.split('-')[3]);
      votes[mapIndex]++;
      await i.reply({ content: `✅ You voted for **${maps[mapIndex]}**!`, ephemeral: true });
    });

    collector.on('end', async () => {
      const maxVotes = Math.max(...votes);
      const winners = maps.filter((_, index) => votes[index] === maxVotes);
      const selectedMap = winners[Math.floor(Math.random() * winners.length)];

      game.map = selectedMap;
      game.status = 'pending';
      await game.save();

      await finalizeMatch(guild, channel, game);
    });
  }
}

async function handleMapVote(interaction) {
  // Handled by the collector in handlePicking for now to maintain map context easily
  // If we want it to be persistent across restarts, we'd need to store maps in the game model
}

async function finalizeMatch(guild, channel, game) {
  try {
    const teams = [
      await Promise.all(game.teamA.map(id => guild.members.fetch(id))),
      await Promise.all(game.teamB.map(id => guild.members.fetch(id)))
    ];

    const teamVCTasks = teams.map((team, i) => guild.channels.create({
      name: `#${game.gameId} Team ${i + 1}`,
      type: ChannelType.GuildVoice,
      parent: game.categoryId,
      permissionOverwrites: require('../queue/queueManager').getPermissionOverwrites(team, PermissionFlagsBits.Connect, false)
    }));

    const createdTeamVCs = await Promise.all(teamVCTasks);
    game.voiceAId = createdTeamVCs[0].id;
    game.voiceBId = createdTeamVCs[1].id;
    await game.save();

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

    const teamMentions = teams.map(team => team.map(m => `<@${m.id}>`));
    const finalEmbed = {
      title: `Match #${game.gameId} Ready!`,
      description:
        `🗺️ **Map:** ${game.map}\n\n` +
        `👥 **Teams:**\n• **Team 1:** ${teamMentions[0].join(', ')}\n• **Team 2:** ${teamMentions[1].join(', ')}\n\n` +
        `📜 **Match Rules:**\n• Note: Standard rules apply.\n\n` +
        `${game.rules?.rulesEmbed || ''}`,
      color: 0x00ff00
    };
    
    // Edit the last message to show finalized match
    const messages = await channel.messages.fetch({ limit: 5 });
    const lastBotMsg = messages.find(m => m.author.id === guild.client.user.id && m.embeds.length > 0);
    if (lastBotMsg) {
      await lastBotMsg.edit({ content: `✅ Match #${game.gameId} is starting!`, embeds: [finalEmbed], components: [] });
    } else {
      await channel.send({ content: `✅ Match #${game.gameId} is starting!`, embeds: [finalEmbed] });
    }

    await logMatch(game.gameId, game.teamA, game.teamB, { 
      queueType: game.queueType, 
      mapName: game.map 
    });

    const [teamAData, teamBData] = await Promise.all([
      Promise.all(game.teamA.map(async id => {
        const m = await guild.members.fetch(id);
        const p = await Player.load(m);
        return { id: p.id, ign: p.ingameUsername, elo: p.elo };
      })),
      Promise.all(game.teamB.map(async id => {
        const m = await guild.members.fetch(id);
        const p = await Player.load(m);
        return { id: p.id, ign: p.ingameUsername, elo: p.elo };
      }))
    ]);

    const formattedMap = `w_4_0_${game.map.toLowerCase()}`;
    await publishMatch({
      matchId: game.gameId,
      queueType: game.queueType,
      map: formattedMap,
      teamA: teamAData,
      teamB: teamBData
    });

    if (process.env.MATCH_LOGS_ID) {
      await sendLogToStaffChannel(guild.client, guild.id, game.gameId, process.env.MATCH_LOGS_ID);
    }

  } catch (err) {
    console.error(`[PickingInteraction] Failed to finalize match:`, err);
    await channel.send({ content: "❌ Failed to finalize match creation. Please contact staff." });
  }
}
};
