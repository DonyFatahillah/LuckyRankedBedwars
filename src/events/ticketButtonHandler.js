const {
  Events,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const crypto = require('crypto');
require('dotenv').config();

const STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const TICKET_LOGS_CHANNEL_ID = process.env.TICKET_LOGS_CHANNEL_ID;
const TICKET_STAFF_LOGS_ID = process.env.TICKET_STAFF_LOGS_ID;

const { isBanned } = require('../utils/ticketBanManager');

function generateTicketId() {
  return crypto.randomBytes(3).toString('hex'); // e.g., a2c3fg
}

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('ticket:')) return;

    const user = interaction.user;

    // ❌ Check if user is banned from opening tickets
    if (await isBanned(user.id)) {
      return interaction.reply({
        content: '⛔ You are banned from opening tickets.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const type = interaction.customId.split(':')[1]; // general, report, etc.
    const ticketId = generateTicketId();
    const sanitizedUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ticketName = `${type}-${ticketId}-${sanitizedUsername}`.slice(0, 100);

    // ✅ Prevent duplicate ticket of the same type
    const existing = interaction.guild.channels.cache.find(channel =>
      channel.parentId === TICKET_CATEGORY_ID &&
      channel.name.startsWith(`${type}-`) &&
      channel.permissionOverwrites.cache.has(user.id)
    );

    if (existing) {
      return interaction.reply({
        content: `❌ You already have an open **${type}** ticket: ${existing}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ✅ Create the private ticket channel
    const ticketChannel = await interaction.guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: STAFF_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
          ],
        },
      ],
    });

    // ✅ Acknowledge interaction
    await interaction.reply({
      content: `🎟️ Ticket created: ${ticketChannel}`,
      flags: MessageFlags.Ephemeral,
    });

    // ✅ Send welcome message in ticket
    await ticketChannel.send({
      content: `Hello <@${user.id}>! A staff member <@&${STAFF_ROLE_ID}> will be with you shortly.\n` +
        `Ticket type: \`${type}\``,
    });

    // ✅ Public log
    try {
      const ticketLogs = await interaction.guild.channels.fetch(TICKET_LOGS_CHANNEL_ID);
      if (ticketLogs?.send) {
        await ticketLogs.send({
          content: `🗃️ <@${user.id}>, your ticket **${ticketName}** has been created in ${ticketChannel}.`,
        });
      }
    } catch (err) {
      console.warn(`[Ticket Logs] Could not send log: ${err.message}`);
    }

    // ✅ Staff log
    try {
      const staffLogs = await interaction.guild.channels.fetch(TICKET_STAFF_LOGS_ID);
      if (staffLogs?.send) {
        await staffLogs.send({
          content: `📩 <@${user.id}> opened a \`${type}\` ticket: ${ticketChannel} <@&${STAFF_ROLE_ID}>`,
        });
      }
    } catch (err) {
      console.warn(`[Staff Logs] Could not send staff log: ${err.message}`);
    }
  },
};
