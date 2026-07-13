const { SlashCommandBuilder } = require('discord.js');
const { generateScoreImage } = require('../../utils/scoreImage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debugcanvas')
    .setDescription('Generate a dummy score image to test canvas positions')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Select the team size to test layout centering')
        .setRequired(false)
        .addChoices(
          { name: '1v1', value: '1v1' },
          { name: '3v3', value: '3v3' },
          { name: '4v4', value: '4v4' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const mode = interaction.options.getString('mode') || '4v4';
      const count = parseInt(mode.charAt(0)); // '1' from '1v1', etc.

      // Dummy data for testing
      const gameId = '12345';
      const winningTeam = 'team1';
      const mvp = 'Molfordan, Player3';
      const winBedbreaker = 'Molfordan';
      const loseBedbreaker = 'Player5';

      const allWinners = [
        { nickname: 'Molfordan', oldElo: 1000, newElo: 1025, result: '🏆 Win', team: 'team1', name: 'Molfordan' },
        { nickname: 'Player2', oldElo: 1050, newElo: 1070, result: '🏆 Win', team: 'team1', name: 'Steve' },
        { nickname: 'Player3', oldElo: 980, newElo: 1005, result: '🏆 Win', team: 'team1', name: 'Alex' },
        { nickname: 'Player4', oldElo: 1100, newElo: 1120, result: '🏆 Win', team: 'team1', name: 'Dream' }
      ];

      const allLosers = [
        { nickname: 'HitRate', oldElo: 1020, newElo: 995, result: '❌ Loss', team: 'team2', name: 'HitRate' },
        { nickname: 'Player6', oldElo: 950, newElo: 935, result: '❌ Loss', team: 'team2', name: 'Herobrine' },
        { nickname: 'Player7', oldElo: 1000, newElo: 980, result: '❌ Loss', team: 'team2', name: 'DanTDM' },
        { nickname: 'Player8', oldElo: 1050, newElo: 1025, result: '❌ Loss', team: 'team2', name: 'Stampy' }
      ];

      // Slice the arrays depending on the requested team size
      const results = [...allWinners.slice(0, count), ...allLosers.slice(0, count)];

      // Call the image generator
      const attachment = await generateScoreImage(gameId, winningTeam, results, mvp, winBedbreaker, loseBedbreaker);

      // Send it
      await interaction.editReply({
        content: `🛠️ **Canvas Debug Output (${mode} Mode)**\nEdit \`src/utils/scoreImage.js\` and run \`/debugcanvas\` again to see changes.`,
        files: [attachment]
      });
    } catch (err) {
      console.error(err);
      await interaction.editReply(`❌ Error generating canvas: ${err.message}`);
    }
  },
};
