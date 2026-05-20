const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const ActiveGame = require('../../models/ActiveGame');
const { publishMatch } = require('../../utils/redisClient');
const Player = require('../../models/Player');
const { logMatch, sendLogToStaffChannel } = require('../../utils/matchLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pick')
    .setDescription('Pick a player for your team (High-tier matches only)')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The player you want to pick')
        .setRequired(true)
    ),

  async execute(interaction) {
    const { guild, channel, user } = interaction;

    // 1. Find the active game associated with this channel
    // Since we don't store textChannelId in Redis searchably easily without scanning,
    // we assume the user is in the match category/channel.
    // We can scan Redis for a game where textChannelId === channel.id
    const allGames = await require('../../queue/queueManager').getActiveGames();
    const gameData = allGames.find(g => g.textChannelId === channel.id);

    if (!gameData || !gameData.pickingPhase) {
      return interaction.reply({ content: "❌ There is no active picking phase in this channel.", ephemeral: true });
    }

    const game = new ActiveGame(gameData);

    // 2. Security Checks
    if (game.pickingTurn !== user.id) {
      return interaction.reply({ content: "❌ It is not your turn to pick!", ephemeral: true });
    }

    const pickedUser = interaction.options.getUser('player');
    if (!game.unpickedPlayers.includes(pickedUser.id)) {
      return interaction.reply({ content: "❌ That player is not in the pool or has already been picked.", ephemeral: true });
    }

    // 3. Update Teams
    const isTeamA = game.captainIds[0] === user.id;
    if (isTeamA) {
      game.teamA.push(pickedUser.id);
    } else {
      game.teamB.push(pickedUser.id);
    }

    // Remove from pool
    game.unpickedPlayers = game.unpickedPlayers.filter(id => id !== pickedUser.id);

    // 4. Determine next turn
    if (game.unpickedPlayers.length > 0) {
      // Toggle turn
      game.pickingTurn = isTeamA ? game.captainIds[1] : game.captainIds[0];
      await game.save();

      const pickingEmbed = {
        title: "🎮 Picking Phase",
        description: `Captain <@${user.id}> picked <@${pickedUser.id}>!\n\nIt is now <@${game.pickingTurn}>'s turn to pick.`,
        fields: [
          { name: "Pool", value: game.unpickedPlayers.map(id => `<@${id}>`).join('\n') || "None", inline: true },
          { name: "Team 1", value: game.teamA.map(id => `<@${id}>`).join('\n'), inline: true },
          { name: "Team 2", value: game.teamB.map(id => `<@${id}>`).join('\n'), inline: true }
        ],
        color: 0xffff00
      };
      return interaction.reply({ embeds: [pickingEmbed] });
    } else {
      // 5. Picking Finished!
      game.pickingPhase = false;
      game.pickingTurn = null;
      game.status = 'pending';
      await game.save();

      await interaction.reply({ content: `✅ Picking complete! Creating team voice channels and starting match...` });

      // Create Voice Channels and move players
      try {
        const category = await guild.channels.fetch(game.categoryId);
        const teams = [
          await Promise.all(game.teamA.map(id => guild.members.fetch(id))),
          await Promise.all(game.teamB.map(id => guild.members.fetch(id)))
        ];

        const teamVCTasks = teams.map((team, i) => guild.channels.create({
          name: `#${game.gameId} Team ${i + 1}`,
          type: ChannelType.GuildVoice,
          parent: game.categoryId,
          permissionOverwrites: require('../../queue/queueManager').getPermissionOverwrites(team, PermissionFlagsBits.Connect, false)
        }));

        const createdTeamVCs = await Promise.all(teamVCTasks);
        game.voiceAId = createdTeamVCs[0].id;
        game.voiceBId = createdTeamVCs[1].id;
        await game.save();

        // Move players
        const moveTasks = [];
        teams.forEach((team, i) => {
          team.forEach(m => {
            if (m.voice?.channelId) {
              moveTasks.push(m.voice.setChannel(createdTeamVCs[i]).catch(() => {}));
            }
          });
        });
        await Promise.all(moveTasks);

        // Delete waiting room if possible
        const waitingRoom = guild.channels.cache.find(c => c.parentId === game.categoryId && c.name.startsWith('🕒 Waiting Room'));
        if (waitingRoom) await waitingRoom.delete().catch(() => {});

        // Final Announcement
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
        await channel.send({ embeds: [finalEmbed] });

        // Log and Publish to Redis
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
        console.error(`[PickCommand] Failed to finalize match:`, err);
        await channel.send({ content: "❌ Failed to finalize match creation. Please contact staff." });
      }
    }
  }
};
