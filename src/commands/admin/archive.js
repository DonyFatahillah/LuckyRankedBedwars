// src/commands/moderation/archive.js
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
require('dotenv').config();

const ARCHIVE_CATEGORY_ID = process.env.ARCHIVE_CATEGORY_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('archive')
    .setDescription('Move a channel (text or voice) to the archived category')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to archive')
        .setRequired(true)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');

    if (!channel || ![ChannelType.GuildText, ChannelType.GuildVoice].includes(channel.type)) {
      return interaction.reply({ content: '❌ Please provide a valid text or voice channel.', ephemeral: true });
    }

    try {
      await channel.setParent(ARCHIVE_CATEGORY_ID, { lockPermissions: false });
      await interaction.reply({ content: `✅ Channel **${channel.name}** has been archived.` });
    } catch (err) {
      console.error('[Archive] Failed to move channel:', err);
      return interaction.reply({ content: '❌ Failed to archive the channel.', ephemeral: true });
    }
  },
};
