// src/buttons/tickets/openTicket.js
const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { generateTicketId, formatChannelName } = require('../../utils/ticketUtils');
require('dotenv').config();

module.exports = {
  customId: /^ticket:(.+)$/,
  async execute(interaction) {
    const type = interaction.customId.split(':')[1];
    const ticketId = generateTicketId();
    const username = interaction.user.username;
    const channelName = formatChannelName(type, ticketId, username);

    const existing = interaction.guild.channels.cache.find(
      ch => ch.name.includes(`${ticketId}-${username.toLowerCase()}`)
    );
    if (existing) {
      return interaction.reply({ content: `❗ You already have an open ticket: <#${existing.id}>`, ephemeral: true });
    }

    const channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: process.env.TICKET_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: process.env.TICKET_STAFF_ROLE_ID,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        }
      ]
    });

    const closeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:close`)
        .setLabel('🔒 Close Ticket')
        .setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
      .setTitle(`📩 Ticket: ${type.toUpperCase()}`)
      .setDescription(`Welcome <@${interaction.user.id}>, please describe your issue below. Staff will assist you shortly.`)
      .setColor(0x2F3136);

    await channel.send({
      content: `<@${interaction.user.id}> <@&${process.env.TICKET_STAFF_ROLE_ID}>`,
      embeds: [embed],
      components: [closeButton]
    });

    await interaction.reply({ content: `✅ Your ticket has been created: ${channel}`, ephemeral: true });

    const staffLog = await interaction.guild.channels.fetch(process.env.TICKET_LOGS_STAFF_ID);
    staffLog.send(`📩 <@${interaction.user.id}> opened a **${type}** ticket ${channel} <@&${process.env.TICKET_STAFF_ROLE_ID}>`);
  }
};
