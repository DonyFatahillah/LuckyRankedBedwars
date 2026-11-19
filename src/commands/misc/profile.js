const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Player = require('../../models/Player');
const PlayerModel = require('../../models/PlayerSchema');
const { generateProfileImage } = require('../../utils/profileImage');
require('dotenv').config();

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

    let stats, mcName;

    if (playerData) {
      // ✅ Use MongoDB data as the primary source of truth
      stats = {
        elo: playerData.elo ?? 0,
        wins: playerData.wins ?? 0,
        losses: playerData.losses ?? 0,
        kills: playerData.kills ?? 0,
        deaths: playerData.deaths ?? 0,
        winstreak: playerData.winstreak ?? 0,
        topKills: playerData.mvps ?? 0,
        bedsBroken: playerData.bedsBroken ?? 0,
        recentlyPlayed: playerData.recentlyPlayed ?? []
      };
      const baseName = playerData.ingameUsername || playerData.discordUsername || (member ? member.user.username : 'Unknown');
      mcName = baseName;
    } else if (member) {
      // ✅ Fallback if no DB entry yet but member exists
      const player = await Player.load(member);
      stats = { ...player.getStats(), elo: player.elo };
      const baseName = player.ingameUsername || player.discordUsername;
      mcName = baseName;
    } else {
      return interaction.editReply({ content: '❌ Unable to find that user data' });
    }

    // Keep the normal/doubles summary alongside the normal-mode profile card.
    const combatData = playerData || stats;
    const combatFields = [
      { name: 'Normal (3v3 / 4v4)', kills: combatData.kills ?? 0, deaths: combatData.deaths ?? 0 },
      { name: 'Doubles (2v2)', kills: combatData.double_kills ?? 0, deaths: combatData.double_deaths ?? 0 }
    ].map(({ name, kills, deaths }) => ({
      name,
      value: `Kills: **${kills}**\nDeaths: **${deaths}**\nK/D: **${(deaths === 0 ? kills : kills / deaths).toFixed(2)}**`,
      inline: true
    }));
    const combatEmbed = new EmbedBuilder()
      .setTitle('Combat stats')
      .setColor(0xFFD700)
      .addFields(combatFields)
      .setFooter({ text: 'K/D uses kills when deaths are 0. MVPs are separate from kills.' });

    const attachment = await generateProfileImage(mcName, stats);
    attachment.setName('profile.png');

    await interaction.editReply({
      content: `📜 Profile of **${mcName}**`,
      embeds: [combatEmbed],
      files: [attachment]
    });
  }
};
