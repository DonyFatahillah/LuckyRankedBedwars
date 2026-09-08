const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mapPicker = require('../../utils/mapPicker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refreshdata')
    .setDescription('Reloads maps, rules, and limits from the data folder without restarting the bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Reload Map List (since it's cached in memory)
      mapPicker.loadMapList();

      // Note: queueRules.yaml and partyLimit.json are already read dynamically 
      // directly from the files whenever their respective commands run, 
      // so no manual reload is needed for them! They update instantly.

      return interaction.editReply({ 
        content: '✅ Successfully refreshed all local data!\n\n*(Note: `queueRules.yaml` and `partylimit.json` actually always update instantly the moment you save the file! `mapList.yaml` has now been reloaded into memory.)*' 
      });
    } catch (error) {
      console.error('[RefreshData Error]', error);
      return interaction.editReply({ content: '❌ An error occurred while refreshing data.' });
    }
  }
};
