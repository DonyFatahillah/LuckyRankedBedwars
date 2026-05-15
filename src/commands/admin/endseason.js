const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const PlayerModel = require('../../models/PlayerSchema');
const MatchLogModel = require('../../models/MatchLogSchema');
const Player = require('../../models/Player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('endseason')
    .setDescription('Ends the ranked season, archives data, and resets stats.')
    .addStringOption(opt => opt.setName('season').setDescription('Season name (e.g., S1, S2-Beta)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const seasonName = interaction.options.getString('season');
    const archiveDir = path.join(__dirname, '../../../archived');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);

    try {
      // 1. Archive Data
      const allPlayers = await PlayerModel.find({}).lean();
      const allMatches = await MatchLogModel.find({}).lean();
      
      const archivePath = path.join(archiveDir, `archived-season-${seasonName}.json`);
      fs.writeFileSync(archivePath, JSON.stringify({ players: allPlayers, matches: allMatches }, null, 2));

      // 2. Aggregate Match Stats for Chart
      const dailyMatches = await MatchLogModel.aggregate([
        { $project: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, status: 1 } },
        { $group: { _id: "$date", total: { $sum: 1 }, voided: { $sum: { $cond: [{ $eq: ["$status", "void"] }, 1, 0] } } } },
        { $sort: { _id: 1 } }
      ]);

      const labels = dailyMatches.map(m => m._id);
      const totals = dailyMatches.map(m => m.total);
      const voids = dailyMatches.map(m => m.voided);

      // 3. Get Top 8
      const top8 = await PlayerModel.find({}).sort({ elo: -1 }).limit(8);

      // 4. Generate Chart URL (QuickChart)
      const chartUrl = `https://quickchart.io/chart?c={type:'line',data:{labels:[${labels.map(l => `'${l}'`).join(',')}],datasets:[{label:'Total Matches',data:[${totals.join(',')}],borderColor:'purple',fill:false},{label:'Voided',data:[${voids.join(',')}],borderColor:'gray',fill:false}]}}`;

      // 5. Reset Stats
      await PlayerModel.updateMany({}, { $set: { elo: 1000, wins: 0, losses: 0, winstreak: 0, mvps: 0, bedsBroken: 0 } });
      await MatchLogModel.deleteMany({});
      // Note: Redis cache should be cleared here ideally as well

      // 6. Report
      const embed = new EmbedBuilder()
        .setTitle(`🏁 Season ${seasonName} Archive & Reset Complete`)
        .setDescription(`Archive saved to \`${archivePath}\``)
        .addFields(
          { name: '🏆 Top 8 ELO', value: top8.map((p, i) => `\`${i+1}.\` <@${p.userId}> - **${p.elo}**`).join('\n') },
        )
        .setImage(chartUrl)
        .setColor(0x800080);

      await interaction.editReply({ content: '✅ Season ended successfully.', embeds: [embed] });
      
      // Notify guild members (Optional: update nicknames/roles)
      // Implementation depends on if you want to iterate every user
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: '❌ Failed to archive and reset season.' });
    }
  }
};
