const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const PlayerModel = require('../../models/PlayerSchema');
const { getElo } = require('../../utils/eloManager');
const { redis } = require('../../utils/redisClient');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('statsresetall')
    .setDescription('Reset ALL player statistics to 0')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Reset all players in MongoDB
      await PlayerModel.updateMany({}, {
        $set: {
          wins: 0,
          losses: 0,
          winstreak: 0,
          mvps: 0,
          bedsBroken: 0,
          elo: 0,
          recentlyPlayed: []
        }
      });

      // Clear local JSON stats as well
      const fs = require('fs');
      const path = require('path');
      const STATS_PATH = path.join(__dirname, '../../../data/playerStats.json');
      if (fs.existsSync(STATS_PATH)) {
        fs.writeFileSync(STATS_PATH, JSON.stringify({}, null, 2));
      }

      // Clear Redis cache and elo keys
      try {
        const playerKeys = await redis.keys('player.cache:*');
        const eloKeys = await redis.keys('elo:*');
        const gameKeys = await redis.keys('game:*');
        const matchKeys = await redis.keys('match:*');
        const allKeys = [...playerKeys, ...eloKeys, ...gameKeys, ...matchKeys];
        
        if (allKeys.length > 0) {
          await redis.del(allKeys);
          console.log(`[StatsResetAll] Cleared ${allKeys.length} Redis keys.`);
        }
      } catch (redisErr) {
        console.error('[StatsResetAll] Redis clear failed:', redisErr);
      }

      await interaction.editReply({ content: '✅ All player statistics have been reset to 0.' });
    } catch (err) {
      console.error('[StatsResetAll] Error:', err);
      await interaction.editReply({ content: '❌ Failed to reset statistics.' });
    }
  }
};
