const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');
const { logStaffCommand } = require('../../utils/staffLogger');


module.exports = {
  data: new SlashCommandBuilder()
    .setName('setelo')
    .setDescription('Manually set a player\'s ELO (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // ✅ Admin-only
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The player to set ELO for')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('elo')
        .setDescription('The new ELO value')
        .setRequired(true)
        .setMinValue(0)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const newElo = interaction.options.getInteger('elo');

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    const player = await Player.load(member);
    await player.setElo(newElo); // ✅ sets + saves + updates nickname + role

    await interaction.reply({
      content: `✅ Set **${member.displayName}**'s ELO to **${newElo}**.`,
      ephemeral: true
    });
      
    await logStaffCommand(interaction);
  }
};
