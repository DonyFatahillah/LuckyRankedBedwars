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

    try {
      if (isSelect && interaction.customId.startsWith('picking-select-')) {
        await handlePicking(interaction);
      }
    } catch (err) {
      console.error('[PickingInteraction] Error handling picking:', err);
    }
  }
};

async function handlePicking(interaction) {
  const gameId = interaction.customId.split('-')[2];
  const { guild, channel, user } = interaction;

  // Targeted load is much faster than fetching all games
  const game = await ActiveGame.load(gameId);

  if (!game || !game.pickingPhase) {
    return interaction.reply({ content: "❌ This picking phase is no longer active.", flags: [64] });
  }

  if (game.pickingTurn !== user.id) {
    return interaction.reply({ content: "❌ It is not your turn to pick!", flags: [64] });
  }

  const pickedUserId = interaction.values[0];
  if (!game.unpickedPlayers.includes(pickedUserId)) {
    return interaction.reply({ content: "❌ That player is no longer available.", flags: [64] });
  }

  // Defer update here to give us more time for the logic and message building
  try {
    await interaction.deferUpdate();
  } catch (err) {
    console.error(`[PickingInteraction] Failed to defer update for game ${gameId}:`, err);
    return;
  }

  const isTeamA = game.captainIds[0] === user.id;
  if (isTeamA) {
    game.teamA.push(pickedUserId);
  } else {
    game.teamB.push(pickedUserId);
  }

  game.unpickedPlayers = game.unpickedPlayers.filter(id => id !== pickedUserId);

  let autoPickedUserId = null;
  if (game.unpickedPlayers.length === 1) {
    autoPickedUserId = game.unpickedPlayers[0];
    const isNextTeamA = !isTeamA;
    if (isNextTeamA) {
      game.teamA.push(autoPickedUserId);
    } else {
      game.teamB.push(autoPickedUserId);
    }
    game.unpickedPlayers = [];
  }

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
      description: `Captain <@${user.id}> picked <@${pickedUserId}>!\n\nIt is now Captain <@${game.pickingTurn}>'s turn to pick.`,
      fields: [
        { name: "Pool", value: game.unpickedPlayers.map(id => `<@${id}>`).join('\n') || "None", inline: true },
        { name: "Team 1", value: game.teamA.map(id => game.captainIds && game.captainIds[0] === id ? `<@${id}> (Captain)` : `<@${id}>`).join('\n'), inline: true },
        { name: "Team 2", value: game.teamB.map(id => game.captainIds && game.captainIds[1] === id ? `<@${id}> (Captain)` : `<@${id}>`).join('\n'), inline: true }
      ],
      color: 0xffff00
    };

    try {
      return await interaction.editReply({ 
        content: `Captain <@${user.id}> picked <@${pickedUserId}>, now it's Captain <@${game.pickingTurn}> to pick.`,
        embeds: [pickingEmbed], 
        components: [row] 
      });
    } catch (err) {
      return await channel.send({ 
        content: `Captain <@${user.id}> picked <@${pickedUserId}>, now it's Captain <@${game.pickingTurn}> to pick.`,
        embeds: [pickingEmbed], 
        components: [row] 
      }).catch(() => {});
    }
  } else {
    // Picking Finished!
    game.pickingPhase = false;
    game.pickingTurn = null;
    await game.save();

    let finishContent = `✅ Picking finished!`;
    if (autoPickedUserId) {
      finishContent = `✅ Captain <@${user.id}> picked <@${pickedUserId}>. The last player <@${autoPickedUserId}> was automatically added to the other team.`;
    }

    if (game.isArenaPicking) {
      game.status = 'voting';
      await game.save();
      
      try {
        await interaction.editReply({ content: `${finishContent}\nStarting map selection...`, embeds: [], components: [] });
      } catch (e) {
        await channel.send({ content: `${finishContent}\nStarting map selection...` }).catch(() => {});
      }
      await startMapVoting(guild, channel, game);
    } else {
      const mapPicker = require('../utils/mapPicker');
      const { finalizeMatch } = require('../utils/matchFinalizer');
      const selectedMap = mapPicker.getRandomMap();
      game.map = selectedMap;
      game.status = 'pending';
      await game.save();
      
      try {
        await interaction.editReply({ content: `${finishContent}\nSelected map: **${selectedMap}**. Finalizing match...`, embeds: [], components: [] });
      } catch (e) {
        await channel.send({ content: `${finishContent}\nSelected map: **${selectedMap}**. Finalizing match...` }).catch(() => {});
      }
      await finalizeMatch(guild, channel, game);
    }
  }
}
