const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  PermissionFlagsBits
} = require('discord.js');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Send the ticket support panel (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // Banner image (optional - replace with your own file path or remove)
    const banner = new AttachmentBuilder(path.join(__dirname, '../../../assets/ticket_banner.png'));

    const panelEmbed = new EmbedBuilder()
      .setTitle('🎟️ Need Help? Open a Ticket!')
      .setDescription([
        'Choose a category below to get support:',
        '',
        '🖥️ **General** → Ask a question and get help',
        '👤 **Report** → Report a player for a violation',
        '⚖️ **Appeals** → Appeal a strike, mute, or ban',
        '🎯 **Scoring** → Dispute the outcome of a Ranked game',
        '🛒 **Store** → For store-related or payment issues',
        '',
        '_A staff member will assist you shortly after creating a ticket._'
      ].join('\n'))
      .setColor('#5865F2')
      .setImage('attachment://ticket_banner.png');

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:general')
        .setLabel('🖥️ General')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('ticket:report')
        .setLabel('👤 Report')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('ticket:appeals')
        .setLabel('⚖️ Appeals')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('ticket:scoring')
        .setLabel('🎯 Scoring')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ticket:store')
        .setLabel('🛒 Store')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.channel.send({
      embeds: [panelEmbed],
      components: [buttonRow],
      files: [banner]
    });

    await interaction.editReply({ content: '✅ Ticket panel sent successfully.' });
  }
};
