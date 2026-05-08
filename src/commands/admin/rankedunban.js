// src/commands/admin/rankedunban.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const BAN_DB = path.join(__dirname, '../../../data/rankedBans.json');
const RANKED_BANNED_ROLE_ID = process.env.RANKED_BANNED_ROLE_ID;
const PUNISHMENT_LOGS_CHANNEL_ID = process.env.PUNISHMENT_LOGS_CHANNEL_ID;

function loadBans() {
  return fs.existsSync(BAN_DB) ? JSON.parse(fs.readFileSync(BAN_DB)) : {};
}

function saveBans(bans) {
  fs.writeFileSync(BAN_DB, JSON.stringify(bans, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankedunban')
    .setDescription('Remove a user\'s ranked ban manually')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to unban')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const bans = loadBans();
    if (!bans[user.id]) {
      return interaction.editReply({ content: `❌ <@${user.id}> is not ranked banned.` });
    }

    delete bans[user.id];
    saveBans(bans);

    if (member) {
      const bannedRole = interaction.guild.roles.cache.get(RANKED_BANNED_ROLE_ID);
      if (bannedRole) {
        await member.roles.remove(bannedRole).catch(() => {});
      }
    }

    const logChannel = await interaction.guild.channels.fetch(PUNISHMENT_LOGS_CHANNEL_ID).catch(() => null);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Ranked Ban Removed')
        .setDescription(`<@${user.id}> has been manually unbanned from ranked.`)
        .setColor(0x00ff00)
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }

    return interaction.editReply({ content: `✅ <@${user.id}> has been unbanned from ranked.` });
  }
};
