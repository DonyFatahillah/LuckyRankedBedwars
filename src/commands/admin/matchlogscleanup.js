const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const MatchLogModel = require('../../models/MatchLogSchema');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matchlogscleanup')
    .setDescription('Delete all match logs from the database')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      await MatchLogModel.deleteMany({});
      
      // Optionally clean up local match logs file
      const fs = require('fs');
      const path = require('path');
      const LOGS_PATH = path.join(__dirname, '../../../data/matchLogs.json');
      if (fs.existsSync(LOGS_PATH)) {
        fs.writeFileSync(LOGS_PATH, JSON.stringify({}, null, 2));
      }

      await interaction.editReply({ content: '✅ All match logs have been deleted.' });
    } catch (err) {
      console.error('[MatchLogsCleanup] Error:', err);
      await interaction.editReply({ content: '❌ Failed to clean up match logs.' });
    }
  }
};
