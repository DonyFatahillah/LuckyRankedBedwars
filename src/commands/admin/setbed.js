const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setbed')
    .setDescription('Set the number of wins for a player.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('player')
        .setDescription('Select the player')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of wins to set')
        .setRequired(true)
        .setMinValue(0)
    ),

  async execute(interaction) {
    const member = interaction.options.getMember('player');
    const amount = interaction.options.getInteger('amount');

    if (!member) {
      return interaction.reply({ content: '❌ Failed to find that member.', ephemeral: true });
    }

    const player = new Player(member);
    await player.setBedsbroken(amount);

    return interaction.reply({
      content: `✅ Set **${member.displayName}**'s bedsbroken to \`${amount}\``,
      ephemeral: true
    });
  }
};
