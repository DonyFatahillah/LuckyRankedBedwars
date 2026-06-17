const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const PlayerModel = require('../../models/PlayerSchema');
const MatchLogModel = require('../../models/MatchLogSchema');
const Player = require('../../models/Player');
const { redis } = require('../../utils/redisClient');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('endseason')
    .setDescription('Ends the ranked season, archives data, and resets stats.')
    .addStringOption(opt => opt.setName('season').setDescription('Season name (e.g., S1, S2-Beta)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });
    const seasonName = interaction.options.getString('season');
    const archiveDir = path.join(__dirname, '../../../archived');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);

    try {
      // 1. Capture & Archive Data (Source of truth before reset)
      const allPlayers = await PlayerModel.find({}).lean();
      const allMatches = await MatchLogModel.find({}).lean();
      
      const archivePath = path.join(archiveDir, `archived-season-${seasonName}.json`);
      fs.writeFileSync(archivePath, JSON.stringify({ players: allPlayers, matches: allMatches }, null, 2));

      // 2. Aggregate Match Stats for Chart (Using captured matches)
      const dailyMatches = await MatchLogModel.aggregate([
        { 
          $project: { 
            date: { 
              $dateToString: { 
                format: "%Y-%m-%d", 
                date: { $ifNull: ["$createdAt", { $toDate: "$timestamp" }] } 
              } 
            }, 
            status: 1 
          } 
        },
        { 
          $group: { 
            _id: "$date", 
            total: { $sum: 1 }, 
            voided: { $sum: { $cond: [{ $in: ["$status", ["void", "Voided", "voided"]] }, 1, 0] } } 
          } 
        },
        { $sort: { _id: -1 } },
        { $limit: 31 },
        { $sort: { _id: 1 } } // Sort back to chronological for chart display
      ]);

      const labels = dailyMatches.map(m => m._id).filter(l => l);
      const totals = dailyMatches.map(m => m.total);
      const voids = dailyMatches.map(m => m.voided);

      // 3. Get Top 16 from Captured Data
      const top16 = [...allPlayers]
        .sort((a, b) => (b.elo || 0) - (a.elo || 0))
        .slice(0, 16);

      // 4. Generate Chart URL (QuickChart)
      let chartUrl = null;
      if (labels.length > 0) {
        const chartConfig = {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'Matches',
                data: totals,
                borderColor: 'purple',
                fill: false
              },
              {
                label: 'Voided',
                data: voids,
                borderColor: 'gray',
                fill: false
              }
            ]
          },
          options: {
            backgroundColor: 'white'
          }
        };
        chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=300&v=2.9.4`;
      }

      // 5. Generate & Send Report
      const top16Value = top16.length > 0 
        ? top16.map((p, i) => `\`${i+1}.\` <@${p.userId}> - **${p.elo}**`).join('\n')
        : 'No players found.';

      const embed = new EmbedBuilder()
        .setTitle(`🏁 Season ${seasonName} Archive & Reset Complete`)
        .setDescription(`Archive saved to \`${archivePath}\``)
        .addFields(
          { name: '🏆 Top 16 ELO', value: top16Value },
        )
        .setColor(0x800080);

      if (chartUrl) {
        embed.setImage(chartUrl);
      }

      await interaction.editReply({ content: '✅ Season ended successfully.', embeds: [embed] });

      // 6. Final Reset (Perform ONLY after reporting to ensure data integrity)
      await PlayerModel.updateMany({}, { $set: { elo: 0, wins: 0, losses: 0, winstreak: 0, mvps: 0, bedsBroken: 0 } });
      await MatchLogModel.deleteMany({});
      
      try {
        const playerKeys = await redis.keys('player.cache:*');
        const gameKeys = await redis.keys('game:*');
        const matchKeys = await redis.keys('match:*');
        const allKeys = [...playerKeys, ...gameKeys, ...matchKeys];
        
        if (allKeys.length > 0) {
          await redis.del(allKeys);
          console.log(`[endseason] Cleared ${allKeys.length} Redis keys.`);
        }
      } catch (redisErr) {
        console.error('[endseason] Redis clear failed:', redisErr);
      }
      
      console.log(`[endseason] Season ${seasonName} reset successfully.`);
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: '❌ Failed to archive and reset season.' });
    }
  }
};
