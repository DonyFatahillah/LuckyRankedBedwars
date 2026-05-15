const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');
const PlayerModel = require('../../models/PlayerSchema');
const { deletePlayerCache } = require('../../utils/redisClient');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetstats')
    .setDescription('Reset statistics for a specific player.')
    .addUserOption(option => 
      option.setName('target')
        .setDescription('The user whose stats to reset')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getMember('target');

    try {
      // 1. Reset in Database
      await PlayerModel.findOneAndUpdate(
        { userId: target.id },
        { $set: { wins: 0, losses: 0, winstreak: 0, mvps: 0, bedsBroken: 0 } }
      );

      // 2. Clear Redis Cache
      await deletePlayerCache(target.id);

      // 3. Optional: Reload and sync nickname if the Player class instance is active
      const player = await Player.load(target);
      player.wins = 0;
      player.losses = 0;
      player.winstreak = 0;
      player.topKills = 0;
      player.bedsBroken = 0;
      await player.save();

      await interaction.editReply(`✅ Statistics for ${target.displayName} have been reset.`);
    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Failed to reset stats for this user.');
    }
  }
};

