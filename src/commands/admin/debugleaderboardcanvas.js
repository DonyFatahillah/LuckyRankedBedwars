const { SlashCommandBuilder } = require('discord.js');
const { generateLeaderboardImage } = require('../../utils/leaderboardImage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debugleaderboardcanvas')
    .setDescription('Generate a dummy leaderboard to test canvas positions and podium colors'),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const names = ['Molfordan', 'HitRate', 'Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank', 'PlayerNine', 'PlayerTen'];
      const entries = names.map((username, index) => ({
        username,
        elo: 2050 - index * 175,
        wins: 240 - index * 17,
        losses: 60 + index * 9,
        kills: 3200 - index * 210,
        deaths: 850 + index * 75
      }));
      const attachment = await generateLeaderboardImage(entries, { title: 'NORMAL (3v3 / 4v4) ELO LEADERBOARD' });
      await interaction.editReply({
        content: '🛠️ **Leaderboard Canvas Debug**\nDummy stats only. Top 3: gold, silver, and bronze. Edit `src/utils/leaderboardImage.js` and run `/debugleaderboardcanvas` again to preview changes.',
        files: [attachment]
      });
    } catch (err) {
      console.error('[debugleaderboardcanvas] Failed to generate leaderboard:', err);
      await interaction.editReply({ content: `❌ Error generating leaderboard canvas: ${err.message}` });
    }
  }
};
