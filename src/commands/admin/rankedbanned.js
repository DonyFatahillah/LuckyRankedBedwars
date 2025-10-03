// src/commands/admin/rankedbanned.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PUNISHMENT_LOGS_CHANNEL_ID = process.env.PUNISHMENT_LOGS_CHANNEL_ID;
const RANKED_BANNED_ROLE_ID = process.env.RANKED_BANNED_ROLE_ID;
const BANS_PATH = path.join(__dirname, '../../../data/rankedBans.json');

function loadBans() {
  return fs.existsSync(BANS_PATH) ? JSON.parse(fs.readFileSync(BANS_PATH)) : {};
}

function saveBans(bans) {
  fs.writeFileSync(BANS_PATH, JSON.stringify(bans, null, 2));
}

function parseDuration(input) {
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankedbanned')
    .setDescription('Ban a user from ranked for a set duration')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to ban from ranked')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration of the ban (e.g. 1d, 3h, 15m)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the ban')
        .setRequired(false) // ✅ MUST come last
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const issuedBy = interaction.user;

    if (!member) {
      return interaction.editReply({ content: '❌ Could not fetch that member.' });
    }

    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      return interaction.editReply({ content: '❌ Invalid duration. Use formats like `1d`, `2h`, `30m`.' });
    }

    const expiresAt = Date.now() + durationMs;

    // Save to ban database
    const bans = loadBans();
    bans[user.id] = {
      userId: user.id,
      username: user.username,
      displayName: member.displayName,
      reason,
      issuedBy: issuedBy.id,
      issuedAt: new Date().toISOString(),
      expiresAt
    };
    saveBans(bans);

    // Assign the banned role
    const bannedRole = interaction.guild.roles.cache.get(RANKED_BANNED_ROLE_ID);
    if (bannedRole) {
      await member.roles.add(bannedRole).catch(() => {});
    }

    // Send embed to punishment logs
    const logChannel = await interaction.guild.channels.fetch(PUNISHMENT_LOGS_CHANNEL_ID).catch(() => null);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setTitle('🚫 Ranked Ban Issued')
        .addFields(
          { name: '👤 User', value: `<@${user.id}> (${user.tag})`, inline: false },
          { name: '🕒 Duration', value: durationStr, inline: true },
          { name: '📄 Reason', value: reason, inline: true },
          { name: '👮‍♂️ Issued by', value: `<@${issuedBy.id}>`, inline: false },
          { name: '⏰ Expires At', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: false }
        )
        .setColor(0xff0000)
        .setTimestamp();

      await logChannel.send({ embeds: [embed] });
    }

    await interaction.editReply({
      content: `✅ <@${user.id}> has been **ranked banned** for \`${durationStr}\`.`
    });
  }
};
