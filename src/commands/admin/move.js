// src/commands/admin/move.js
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a channel into a different category.')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to move (voice/text)')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildText)
    )
    .addChannelOption(opt =>
      opt.setName('categorytarget')
        .setDescription('The target category')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const targetCategory = interaction.options.getChannel('categorytarget');

    // Safety check
    if (!channel || !targetCategory) {
      return interaction.reply({
        content: '❌ Invalid channel or category.',
        ephemeral: true
      });
    }

    try {
      await channel.edit({ parent: targetCategory.id });
      await interaction.reply({
        content: `✅ Moved <#${channel.id}> to category **${targetCategory.name}**.`,
        ephemeral: false
      });
    } catch (err) {
      console.error('[Move Command] Failed to move channel:', err);
      await interaction.reply({
        content: '❌ Failed to move the channel. Do I have permission?',
        ephemeral: true
      });
    }
  }
};
