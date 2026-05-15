const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const PlayerModel = require('../../models/PlayerSchema');
const MatchLogModel = require('../../models/MatchLogSchema'); // Assume model exists
const ActiveGameModel = require('../../models/ActiveGameSchema'); // Assume model exists

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetalldata')
    .setDescription('WARNING: Clear ALL data from MongoDB database ONLY.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // 1. Clear MongoDB collections
      await PlayerModel.deleteMany({});
      await MatchLogModel.deleteMany({});
      await ActiveGameModel.deleteMany({});

      await interaction.editReply('✅ Successfully wiped all data from MongoDB.');
    } catch (err) {
      console.error('[ResetAllData] Error:', err);
      await interaction.editReply('❌ Failed to wipe data from MongoDB. Check logs.');
    }
  }
};
