const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const axios = require('axios');
const path = require('path');
const Player = require('../../models/Player');
const PlayerModel = require('../../models/PlayerSchema');
const { getRankByElo } = require('../../utils/EloRank');
require('dotenv').config();

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
    )
    .addStringOption(option =>
      option.setName('username')
        .setDescription('The Minecraft username to view')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user');
    const minecraftUsername = interaction.options.getString('username');
    const guild = interaction.guild;
    const verifiedRoleId = process.env.VERIFIED_ROLE_ID || '1401289452633985086';

    let member = null;
    let playerData = null;

    if (minecraftUsername) {
      // 1. Search by Minecraft username
      playerData = await PlayerModel.findOne({ 
        ingameUsername: { $regex: new RegExp("^" + minecraftUsername + "$", "i") } 
      });

      if (!playerData) {
        return interaction.editReply({ content: `❌ No player found with Minecraft username: **${minecraftUsername}**` });
      }

      member = await guild.members.fetch(playerData.userId).catch(() => null);
    } else {
      // 2. Search by Discord user
      const user = targetUser || interaction.user;
      
      // ❌ Block if target is the bot itself
      if (user.id === process.env.CLIENT_ID) {
        return interaction.editReply({ content: '❌ Unable to find that user data' });
      }

      member = await guild.members.fetch(user.id).catch(() => null);
      
      if (!member || !member.roles.cache.has(verifiedRoleId)) {
        return interaction.editReply({ content: '❌ This user is not verified or has no linked account.' });
      }

      playerData = await PlayerModel.findOne({ userId: user.id });
      
      if (!playerData && !member) {
        return interaction.editReply({ content: '❌ Unable to find that user data' });
      }
    }

    let stats, rank, mcName, elo;

    if (playerData) {
      // ✅ Use MongoDB data as the primary source of truth
      elo = playerData.elo || 0;
      stats = {
        wins: playerData.wins || 0,
        losses: playerData.losses || 0,
        winstreak: playerData.winstreak || 0,
        topKills: playerData.mvps || 0,
        bedsBroken: playerData.bedsBroken || 0,
        wlr: playerData.losses === 0 ? (playerData.wins || 0) : ((playerData.wins || 0) / playerData.losses).toFixed(2),
      };
      rank = getRankByElo(elo);
      mcName = playerData.ingameUsername || playerData.discordUsername || (member ? member.user.username : 'Unknown');
    } else if (member) {
      // ✅ Fallback if no DB entry yet but member exists
      const player = new Player(member);
      stats = player.getStats();
      rank = getRankByElo(player.elo);
      mcName = player.ingameUsername || player.discordUsername;
      elo = player.elo;
    } else {
      return interaction.editReply({ content: '❌ Unable to find that user data' });
    }

    const skinRenderUrl = (playerData?.ingameUsername || (member ? (new Player(member)).ingameUsername : null)) 
      ? `https://mc-heads.net/body/${playerData?.ingameUsername || (new Player(member)).ingameUsername}/300`
      : `https://mc-heads.net/body/Steve/300`;

    // Load assets (background + skin)
    const [templateImg, skinImg] = await Promise.all([
      loadImage(path.join(__dirname, '../../../assets/profile_canvas.png')),
      axios.get(skinRenderUrl, { responseType: 'arraybuffer' })
        .then(res => loadImage(res.data))
        .catch(() => null)
    ]);

    const canvas = createCanvas(1365, 768);
    const ctx = canvas.getContext('2d');

    // Draw background
    ctx.drawImage(templateImg, 0, 0, 1365, 768);

    // Username (top of profile)
    ctx.font = 'bold 30px "PlusJakarta"';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(mcName, 548, 83);

    // Minecraft skin (body)
    if (skinImg) {
      ctx.drawImage(skinImg, 465, 175, 175, 400);
    }

    // Text drawing helper
    const write = (text, x, y, size = 28, align = 'center') => {
      ctx.font = `bold ${size}px "PlusJakarta"`;
      ctx.textAlign = align;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(text ?? 0), x, y);
    };

    // Right-side stats
    write(rank.name, 900, 210, 50);          // Rank name
    write(elo, 858, 296, 29, 'left');       // ELO
    write(stats.topKills, 863, 410, 35);     // Top Kills
    write(stats.wins, 1037, 410, 35);        // Wins
    write(stats.bedsBroken, 863, 530, 35);   // Beds Broken
    write(stats.losses, 1037, 530, 35);      // Losses
    write(stats.wlr, 863, 650, 35);          // WLR
    write(stats.wins + stats.losses, 1037, 650, 35); // Total games

    const buffer = canvas.toBuffer('image/png');
    const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });

    await interaction.editReply({
      content: `📜 Profile of **${mcName}**`,
      files: [attachment]
    });
  }
};
