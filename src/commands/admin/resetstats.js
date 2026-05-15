const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const PlayerModel = require('../../models/PlayerSchema');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetstats')
    .setDescription('Clear all player stats (wins, losses, etc) from MongoDB ONLY.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      await PlayerModel.updateMany({}, { $set: { wins: 0, losses: 0, winstreak: 0, mvps: 0, bedsBroken: 0 } });
      await interaction.editReply('✅ Stats reset in MongoDB.');
    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Failed.');
    }
  }
};
