const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getRankByElo } = require('../../utils/EloRank'); // <-- correct import

const eloPath = path.join(__dirname, '../../../data/elo.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show top 10 players by ELO'),

  async execute(interaction) {
    await interaction.deferReply();

    // Load ELO data
    const rawData = fs.readFileSync(eloPath);
    const eloData = JSON.parse(rawData);

    // Convert to array and sort by ELO descending
    const sorted = Object.entries(eloData)
      .sort(([, eloA], [, eloB]) => eloB - eloA)
      .slice(0, 20); // top 10

    // Fetch member display names + generate rank
    const leaderboard = await Promise.all(sorted.map(async ([userId, elo], index) => {
      let name = `Unknown (${userId})`;

      try {
        const member = await interaction.guild.members.fetch(userId);
        name = member.displayName;
      } catch {
        // leave as Unknown if user not found
      }

      const rank = getRankByElo(elo).name;
      return `${index + 1}. ${name} — ${elo} ELO — ${rank}`;
    }));

    // Send embed
    await interaction.editReply({
      embeds: [{
        title: '🏆 ELO LEADERBOARD',
        description: leaderboard.join('\n'),
        color: 0xFFD700,
        timestamp: new Date()
      }]
    });
  }
};
