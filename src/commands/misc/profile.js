const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const axios = require('axios');
const path = require('path');
const Player = require('../../models/Player');
const { getRankByElo } = require('../../utils/EloRank');

// ✅ Register custom font
registerFont(path.join(__dirname, '../../../assets/PlusJakartaSans-Bold.ttf'), {
  family: 'PlusJakarta',
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your or another player\'s profile')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to view')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ content: '❌ Unable to find that user in this server.' });
    }

    const player = new Player(member); // Loads stats
    const stats = player.getStats();
    const rank = getRankByElo(player.elo);

    const mcName = member.displayName.replace(/^\[\d+\]\s*/, '').split(' ')[0];
    const skinRenderUrl = `https://mc-heads.net/body/${mcName}/300`;

    // Load assets (background + skin)
    const [templateImg, skinImg] = await Promise.all([
      loadImage(path.join(__dirname, '../../../assets/profile_canvas.png')),
      axios.get(skinRenderUrl, { responseType: 'arraybuffer' }).then(res => loadImage(res.data)).catch(() => null)
    ]);

    const canvas = createCanvas(1365, 768);
    const ctx = canvas.getContext('2d');

    // Draw base background
    ctx.drawImage(templateImg, 0, 0, 1365, 768);

    // Username
    ctx.font = 'bold 30px "PlusJakarta"';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(mcName, 548, 83);

    // Minecraft skin (body)
    if (skinImg) {
      ctx.drawImage(skinImg, 465, 175, 175, 400);
    }

    // Helper function to write text on canvas
    const write = (text, x, y, size = 28, align = 'center') => {
      ctx.font = `bold ${size}px "PlusJakarta"`;
      ctx.textAlign = align;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(text ?? 0), x, y);
    };

    // Right-side data
    write(rank.name, 900, 210, 50);
    write(player.elo, 858, 296, 29, 'left');

    write(stats.topKills, 863, 410, 35);
    write(stats.wins, 1037, 410, 35);

    write(stats.bedsBroken, 863, 530, 35);
    write(stats.losses, 1037, 530, 35);

    write(stats.wlr, 863, 650, 35);
    write(stats.wins + stats.losses, 1037, 650, 35); // Total Games

    const buffer = canvas.toBuffer('image/png');
    const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });

    await interaction.editReply({ files: [attachment] });
  }
};
