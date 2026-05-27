const { Events, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const ActiveGame = require('../models/ActiveGame');
const { startMapVoting } = require('../utils/matchFinalizer');
const { getActiveGames } = require('../queue/queueManager');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
    
    const isSelect = interaction.isStringSelectMenu();
    const isBtn = interaction.isButton();

    if (isSelect && interaction.customId.startsWith('picking-select-')) {
      await handlePicking(interaction);
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
    await game.save();

    if (game.isArenaPicking) {
      game.status = 'voting';
      await game.save();
      await interaction.update({ content: "✅ Picking finished! Starting map selection...", embeds: [], components: [] });
      await startMapVoting(guild, channel, game);
    } else {
      const mapPicker = require('../utils/mapPicker');
      const { finalizeMatch } = require('../utils/matchFinalizer');
      const selectedMap = mapPicker.getRandomMap();
      game.map = selectedMap;
      game.status = 'pending';
      await game.save();
      await interaction.update({ content: `✅ Picking finished! Selected map: **${selectedMap}**. Finalizing match...`, embeds: [], components: [] });
      await finalizeMatch(guild, channel, game);
    }
  }
}
