const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setusername')
    .setDescription('Set a custom RB username for a player')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('The player whose username you want to change')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('new_username')
        .setDescription('The new Ranked Bedwars username')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames), // only trusted roles

  /**
   * 
   * @param {import('discord.js').ChatInputCommandInteraction} interaction 
   */
  async execute(interaction) {
    const member = interaction.options.getMember('target');
    const newUsername = interaction.options.getString('new_username');

    if (!member) {
      return interaction.reply({ content: '❌ Could not find that member in the server.', ephemeral: true });
    }

    const player = new Player(member);

    await player.setIngameUsername(newUsername);

    return interaction.reply({
      content: `✅ Updated RB ingame username for <@${member.id}> to **${player.ingameUsername}**.`,
      ephemeral: false
    });
  }
};
