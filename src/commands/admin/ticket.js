// src/commands/moderation/ticketban.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const BAN_FILE = path.join(__dirname, '../../../data/ticketBans.json');

// Load existing bans
let ticketBans = {};
if (fs.existsSync(BAN_FILE)) {
  try {
    ticketBans = JSON.parse(fs.readFileSync(BAN_FILE, 'utf-8'));
  } catch (err) {
    console.error('[TicketBan] Failed to load:', err);
  }
}

// Save bans
function saveBans() {
  fs.writeFileSync(BAN_FILE, JSON.stringify(ticketBans, null, 2));
}

// Parse duration strings like "1d", "3h", "15m"
function parseDuration(input) {
  if (!input) return null;
  const match = input.match(/^(\d+)([dhm])$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'd': return value * 86400000;
    case 'h': return value * 3600000;
    case 'm': return value * 60000;
    default: return null;
  }
}

// Check if a user is banned
function isBanned(userId) {
  const ban = ticketBans[userId];
  if (!ban) return false;
  if (ban.expires && Date.now() > ban.expires) {
    delete ticketBans[userId];
    saveBans();
    return false;
  }
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ban or unban users from opening tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('ban')
        .setDescription('Ban a user from opening tickets')
        .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 1d, 3h, 15m)').setRequired(false))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for ban').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('unban')
        .setDescription('Unban a user from opening tickets')
        .addUserOption(opt => opt.setName('user').setDescription('User to unban').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user');

    if (sub === 'ban') {
      const durationStr = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      let expires = null;
      if (durationStr) {
        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
          return interaction.reply({ content: '❌ Invalid duration. Use formats like `1d`, `2h`, `30m`.', ephemeral: true });
        }
        expires = Date.now() + durationMs;
      }

      ticketBans[target.id] = { reason, expires };
      saveBans();

      return interaction.reply({
        content: `✅ <@${target.id}> has been banned from opening tickets.` +
                 `${durationStr ? ` Duration: ${durationStr}` : ''}` +
                 ` Reason: ${reason}`,
        ephemeral: false,
      });
    }

    if (sub === 'unban') {
      if (!ticketBans[target.id]) {
        return interaction.reply({ content: '❌ This user is not banned.', ephemeral: true });
      }

      delete ticketBans[target.id];
      saveBans();

      return interaction.reply({ content: `✅ <@${target.id}> has been unbanned from opening tickets.`, ephemeral: false });
    }
  },

  isBanned,
};
