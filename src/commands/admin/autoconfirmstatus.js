const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isAutoConfirmEnabled } = require('../../utils/autoConfirmManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoconfirmstatus')
    .setDescription('Check whether auto-confirm is currently enabled or disabled.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const enabled = isAutoConfirmEnabled();

    await interaction.reply({
      content: enabled
        ? '🟢 Auto-confirm is currently **ENABLED**.'
        : '🔴 Auto-confirm is currently **DISABLED**.',
      ephemeral: true
    });
  }
};
