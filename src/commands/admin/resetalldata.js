const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const PlayerModel = require('../../models/PlayerSchema');
const MatchLogModel = require('../../models/MatchLogSchema'); // Assume model exists
const ActiveGameModel = require('../../models/ActiveGameSchema'); // Assume model exists
const { redis } = require('../../utils/redisClient');

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

      // 2. Clear Redis cache and elo keys
      try {
        const playerKeys = await redis.keys('player.cache:*');
        const eloKeys = await redis.keys('elo:*');
        const gameKeys = await redis.keys('game:*');
        const matchKeys = await redis.keys('match:*');
        const allKeys = [...playerKeys, ...eloKeys, ...gameKeys, ...matchKeys];
        
        if (allKeys.length > 0) {
          await redis.del(allKeys);
          console.log(`[ResetAllData] Cleared ${allKeys.length} Redis keys.`);
        }
      } catch (redisErr) {
        console.error('[ResetAllData] Redis clear failed:', redisErr);
      }

      await interaction.editReply('✅ Successfully wiped all data from MongoDB and Redis.');
    } catch (err) {
      console.error('[ResetAllData] Error:', err);
      await interaction.editReply('❌ Failed to wipe data from MongoDB. Check logs.');
    }
  }
};
