// src/utils/ticketUtils.js
const crypto = require('crypto');
require('dotenv').config();

function generateTicketId() {
  return crypto.randomBytes(3).toString('hex'); // e.g. a2c3fg
}

function formatChannelName(type, id, username) {
  return `${type}-${id}-${username}`.toLowerCase().replace(/[^a-z0-9\-]/g, '');
}

function buildTicketPermissions(userId) {
  return [
    {
      id: userId,
      allow: ['ViewChannel', 'SendMessages', 'AttachFiles', 'ReadMessageHistory']
    },
    {
      id: process.env.TICKET_STAFF_ROLE_ID,
      allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
    },
    {
      id: interaction.guild.roles.everyone.id,
      deny: ['ViewChannel']
    }
  ];
}

module.exports = {
  generateTicketId,
  formatChannelName,
  buildTicketPermissions
};
