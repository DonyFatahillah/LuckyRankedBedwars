const { SlashCommandBuilder } = require('discord.js');
const { generateProfileImage } = require('../../utils/profileImage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debugprofilecanvas')
    .setDescription('Generate a dummy player profile to test canvas positions')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Minecraft username to preview (defaults to Molfordan)')
        .setMinLength(1)
        .setMaxLength(16)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const username = interaction.options.getString('username') || 'Molfordan';
    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
      return interaction.editReply({ content: '❌ Enter a valid Minecraft username (letters, numbers, and underscores only).' });
    }

    try {
      const attachment = await generateProfileImage(username, {
        elo: 1025, wins: 125, losses: 75, kills: 1580, deaths: 920,
        topKills: 42, bedsBroken: 68, winstreak: 7,
        recentlyPlayed: ['12345', '12344', '12343', '12342', '12341']
      });
      await interaction.editReply({
        content: `🛠️ **Profile Canvas Debug — ${username}**\nDummy stats only; no player data is changed. Edit \`src/utils/profileImage.js\` and run \`/debugprofilecanvas\` again to preview changes.`,
        files: [attachment]
      });
    } catch (err) {
      console.error('[debugprofilecanvas] Failed to generate profile:', err);
      await interaction.editReply({ content: `❌ Error generating profile canvas: ${err.message}` });
    }
  }
};
