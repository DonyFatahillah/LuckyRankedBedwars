// src/buttons/tickets/closeTicket.js
const { PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

module.exports = {
  customId: 'ticket:close',
  async execute(interaction) {
    const channel = interaction.channel;
    const userMention = channel.topic || 'Unknown user';

    // Remove user's access
    await channel.permissionOverwrites.edit(interaction.user.id, {
      ViewChannel: false,
      SendMessages: false
    });

    // Rename and archive
    await channel.setName(`closed-${channel.name}`);
    await channel.setParent(process.env.TICKET_ARCHIVE_ID);

    await interaction.reply({ content: `🔒 Ticket closed.`, ephemeral: true });

    const logs = await interaction.guild.channels.fetch(process.env.TICKET_LOGS_ID);
    logs.send(`✅ <@${interaction.user.id}> your ticket <#${channel.id}> has been closed.`);
  }
};
