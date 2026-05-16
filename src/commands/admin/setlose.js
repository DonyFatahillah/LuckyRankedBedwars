const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlose')
    .setDescription('Set the number of losses for a player.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('player')
        .setDescription('Select the player')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of losses to set')
        .setRequired(true)
        .setMinValue(0)
    ),

  async execute(interaction) {
    const member = interaction.options.getMember('player');
    const amount = interaction.options.getInteger('amount');

    if (!member) {
      return interaction.reply({ content: '❌ Failed to find that member.', ephemeral: true });
    }

    const player = await Player.load(member);
    await player.setlose(amount);

    return interaction.reply({
      content: `✅ Set **${member.displayName}**'s losses to \`${amount}\``,
      ephemeral: true
    });
  }
};
