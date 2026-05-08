// src/commands/mod/closeticket.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
require('dotenv').config();

const TICKET_LOGS_CHANNEL_ID = process.env.TICKET_LOGS_ID;
const TICKET_STAFF_LOGS_ID = process.env.TICKET_STAFF_LOGS_ID;
const TICKET_ARCHIVED_CATEGORY_ID = process.env.TICKET_ARCHIVE_CATEGORY_ID;

// All valid ticket type prefixes
const VALID_TICKET_PREFIXES = ['general-', 'report-', 'appeals-', 'scoring-', 'bugreport-'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('closeticket')
    .setDescription('Close the current ticket (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const channel = interaction.channel;

    // ✅ Validate this is a ticket channel
    if (!VALID_TICKET_PREFIXES.some(prefix => channel.name.startsWith(prefix))) {
      return interaction.reply({
        content: '❌ This is not a valid ticket channel.',
        ephemeral: true,
      });
    }

    // ✅ Get the user ID from channel permissions
    const userPermission = channel.permissionOverwrites.cache.find(po =>
      po.type === 1 && po.allow.has(PermissionFlagsBits.ViewChannel)
    );

    const userId = userPermission?.id;
    if (!userId) {
      return interaction.reply({
        content: '❌ Could not find the ticket owner.',
        ephemeral: true,
      });
    }

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    const username = member?.user?.username?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'unknown';
    const ticketId = channel.name.split('-')[1] || Math.random().toString(36).substring(2, 8);

    // ✅ Rename the channel
    const newName = `closed-${ticketId}-${username}`;
    await channel.setName(newName).catch(() => {});

    // ✅ Move to archive category
    if (TICKET_ARCHIVED_CATEGORY_ID) {
      await channel.setParent(TICKET_ARCHIVED_CATEGORY_ID, { lockPermissions: false }).catch(() => {});
    }

    // ✅ Remove user’s access
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: false,
      SendMessages: false,
    });

    // ✅ Send confirmation in the channel
    await channel.send(`🔒 Ticket closed by <@${interaction.user.id}>.`);

    // ✅ Log to public logs
    try {
      const ticketLogs = await interaction.guild.channels.fetch(TICKET_LOGS_CHANNEL_ID);
      if (ticketLogs?.send) {
        await ticketLogs.send({
          content: `✅ <@${userId}>, your ticket <#${channel.id}> has been closed by <@${interaction.user.id}>.`,
        });
      }
    } catch (err) {
      console.warn(`[Ticket Logs] Error: ${err.message}`);
    }

    // ✅ Log to staff logs
    try {
      const staffLogs = await interaction.guild.channels.fetch(TICKET_STAFF_LOGS_ID);
      if (staffLogs?.send) {
        await staffLogs.send({
          content: `📪 Ticket <#${channel.id}> (${channel.name}) closed by <@${interaction.user.id}>.`,
        });
      }
    } catch (err) {
      console.warn(`[Staff Logs] Error: ${err.message}`);
    }

    // ✅ Respond to the staff member
    await interaction.reply({
      content: `✅ Ticket closed, archived, and renamed to \`${newName}\`.`,
      ephemeral: true,
    });
  },
};
