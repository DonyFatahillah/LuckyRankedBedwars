const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { toggleAutoConfirm, isAutoConfirmEnabled } = require('../../utils/autoConfirmManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoconfirm')
    .setDescription('Toggle auto-confirm feature (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const newState = toggleAutoConfirm();
    await interaction.reply({
      content: `✅ Auto-confirm is now **${newState ? 'enabled' : 'disabled'}**.`,
      ephemeral: true,
    });
  },
};
