// src/commands/moderation/voidrequest.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Player = require('../../models/Player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voidrequest')
    .setDescription('Request to void a recently played game.')
    .addStringOption(option =>
      option.setName('gameid')
        .setDescription('Select the game ID to void')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Optional reason for void request')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'gameid') return;

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.respond([]);

    const player = await Player.load(member);
    const choices = player.recentlyPlayed.map(id => ({ name: id, value: id }));

    const filtered = choices.filter(choice =>
      choice.name.toLowerCase().includes(focused.value.toLowerCase())
    ).slice(0, 25);

    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const gameId = interaction.options.getString('gameid').toUpperCase();
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: '❌ Failed to fetch your member data.', ephemeral: true });
    }

    const player = await Player.load(member);

    if (!player.recentlyPlayed.includes(gameId)) {
      return interaction.reply({
        content: `❌ You have not played a game with ID \`${gameId}\` recently.`,
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🛑 Void Request Submitted')
      .setColor('#FFA500')
      .addFields(
        { name: 'Player', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Game ID', value: gameId, inline: true },
        { name: 'Reason', value: reason, inline: false }
      )
      .setTimestamp();

    const STAFF_CHANNEL_ID = process.env.VOID_REQUEST_CHANNEL_ID;
    const staffChannel = await interaction.guild.channels.fetch(STAFF_CHANNEL_ID).catch(() => null);
    if (staffChannel) await staffChannel.send({ embeds: [embed] });

    await interaction.reply({
      content: `✅ Your void request for game \`${gameId}\` has been submitted to staff.`,
      ephemeral: false
    });
  }
};
