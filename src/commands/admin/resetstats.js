const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Player = require('../../models/Player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetstats')
    .setDescription('Reset all ranked stats for a player (ELO, W/L, winstreak, etc)')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The player to reset')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Optional Discord-side permission
async execute(interaction) {
  await interaction.deferReply({ ephemeral: true }); // 👈 Defer the reply right away

  const targetUser = interaction.options.getUser('player');
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) {
    return interaction.editReply({ content: '❌ That user is not a member of this server.' });
  }

  const player = new Player(member);

  await player.setElo(0);
  await player.setwin(0);
  await player.setlose(0);
  await player.setWinstreak(0);
  await player.setBedsbroken(0);
  await player.setmvps(0);
  await player.save();

  await interaction.editReply(`✅ Successfully reset all stats for <@${targetUser.id}>.`);
}

};
