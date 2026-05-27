const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isPartyMode, setPartyMode, listParties, disbandParty } = require('../../utils/partySystem');
const { logStaffCommand } = require('../../utils/staffLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('togglepartymode')
    .setDescription('Toggle between Solo Season and Party Season.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await logStaffCommand(interaction);

    const currentMode = await isPartyMode();
    const newStatus = !currentMode;
    await setPartyMode(newStatus);

    // ✅ Disband all parties when disabling Party Mode
    if (!newStatus) {
      const parties = listParties();
      for (const { leaderId } of parties) {
        disbandParty(leaderId);
      }
    }

    return interaction.reply({
      content: `✅ Party Mode is now **${newStatus ? 'ENABLED' : 'DISABLED'}**.`,
      ephemeral: true
    });
  }
};
