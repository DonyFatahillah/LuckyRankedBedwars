const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { getActiveGames, deleteActiveGame } = require('../../queue/queueManager');
const { sendLogToStaffChannel } = require('../../utils/matchLogger');

const matchLogPath = path.join(__dirname, '../../../data/matchLogs.json');
require('dotenv').config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invalid')
    .setDescription('Mark a match as invalid')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('gameid')
        .setDescription('The match ID (hex code)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for invalidation')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const activeGames = await getActiveGames();

    const choices = activeGames.map(g => g.gameId)
      .filter(gameId => gameId.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25);

    await interaction.respond(choices.map(id => ({ name: id, value: id })));
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const gameId = interaction.options.getString('gameid').toUpperCase();
    const reason = interaction.options.getString('reason') || 'No reason provided';

    let matchLogs;
    try {
      const raw = fs.readFileSync(matchLogPath);
      matchLogs = JSON.parse(raw);
    } catch (err) {
      return interaction.editReply({ content: '❌ Could not read match logs.' });
    }

    if (!matchLogs[gameId]) {
      return interaction.editReply({ content: `❌ Match #${gameId} not found in logs.` });
    }

    matchLogs[gameId].status = 'invalid';
    matchLogs[gameId].reason = reason;
    matchLogs[gameId].invalidatedBy = interaction.user.id;
    matchLogs[gameId].invalidatedAt = new Date().toISOString();

    fs.writeFileSync(matchLogPath, JSON.stringify(matchLogs, null, 2));

    const activeGames = await getActiveGames();
    const match = activeGames.find(g => g.gameId === gameId);
    if (match) {
      const category = await interaction.guild.channels.fetch(match.categoryId).catch(() => null);
      if (category) {
        for (const channel of category.children.cache.values()) {
          await channel.delete().catch(() => {});
        }
        await category.delete().catch(() => {});
      }

      deleteActiveGame(gameId);

      const textChannel = await interaction.guild.channels.fetch(match.textChannelId).catch(() => null);
      if (textChannel) {
        await textChannel.send(`⚠️ Match #${gameId} has been **invalidated** by staff.\nReason: ${reason}`).catch(() => {});
      }
    }

    // Send updated match logs to staff log + match log channels
    const logChannels = [
      process.env.STAFF_VERIFY_CHANNEL_ID,
      process.env.MATCH_LOGS_ID
    ];

    for (const channelId of logChannels) {
      await sendLogToStaffChannel(interaction.client, interaction.guildId, gameId, channelId);
    }

    await interaction.editReply({
      content: `✅ Match #${gameId} marked as invalid.\nReason: ${reason}`,
    });
  }
};
