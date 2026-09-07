const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const PlayerModel = require('../../models/PlayerSchema');
const { getElo } = require('../../utils/eloManager');
const { redis } = require('../../utils/redisClient');
const { updateRankRoles } = require('../../utils/EloRank');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('statsresetall')
    .setDescription('Reset ALL player statistics to 0 and sync Discord profiles')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // 1. Fetch players before reset so we know whose Discord profiles to update
      const players = await PlayerModel.find({}, 'userId ingameUsername discordUsername displayUsername prefix').lean();

      // 2. Reset all players in MongoDB
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

      // 3. Clear local JSON stats
      const STATS_PATH = path.join(__dirname, '../../../data/playerStats.json');
      if (fs.existsSync(STATS_PATH)) {
        fs.writeFileSync(STATS_PATH, JSON.stringify({}, null, 2));
      }

      // 4. Clear Redis cache and elo keys
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

      // 6. Update Discord Roles and Nicknames
      await interaction.editReply({ content: '⏳ Database reset complete. Syncing Discord roles and nicknames (this may take a moment)...' });

      const guild = interaction.guild;
      if (guild) {
        await guild.members.fetch(); // Fetch all members to ensure cache is populated
        
        for (const p of players) {
          try {
            const member = guild.members.cache.get(p.userId);
            if (member) {
              // Reset Rank Role to 0 ELO (Iron)
              await updateRankRoles(member, 0);

              // Reset Nickname
              const baseName = p.ingameUsername || p.discordUsername;
              const displayPart = p.displayUsername ? ` | ${p.displayUsername}` : '';
              const prefix = p.prefix ? `[0] ` : '';
              const nickname = `${prefix}${baseName}${displayPart}`.substring(0, 32);

              if (member.nickname !== nickname) {
                await member.setNickname(nickname).catch(() => {});
              }
            }
          } catch (e) {
            console.error(`[StatsResetAll] Failed to update Discord profile for ${p.userId}:`, e);
          }
        }
      }

      await interaction.editReply({ content: '✅ All player statistics have been reset to 0, and Discord profiles (roles/nicknames) have been synced!' });
    } catch (err) {
      console.error('[StatsResetAll] Error:', err);
      await interaction.editReply({ content: '❌ Failed to reset statistics.' });
    }
  }
};
