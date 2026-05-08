// src/commands/admin/removestrike.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const STRIKE_DB = path.join(__dirname, '../../../data/strikeData.json');
const PUNISHMENT_LOGS_CHANNEL_ID = process.env.PUNISHMENT_LOGS_CHANNEL_ID;

const STRIKE_ROLES = [
  process.env.STRIKE_I_ROLE_ID,
  process.env.STRIKE_II_ROLE_ID,
  process.env.STRIKE_III_ROLE_ID
];

function loadStrikes() {
  return fs.existsSync(STRIKE_DB) ? JSON.parse(fs.readFileSync(STRIKE_DB)) : {};
}

function saveStrikes(data) {
  fs.writeFileSync(STRIKE_DB, JSON.stringify(data, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removestrike')
    .setDescription('Remove all strike roles and records from a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to remove strike from')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.editReply({ content: '❌ Could not find the member.' });
    }

    const strikes = loadStrikes();

    for (const roleId of STRIKE_ROLES) {
      const role = interaction.guild.roles.cache.get(roleId);
      if (role && member.roles.cache.has(roleId)) {
        await member.roles.remove(role).catch(() => {});
      }
    }

    delete strikes[user.id];
    saveStrikes(strikes);

    const logChannel = await interaction.guild.channels.fetch(PUNISHMENT_LOGS_CHANNEL_ID).catch(() => null);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setTitle('🧹 Strike Cleared')
        .setDescription(`<@${user.id}> has had all strike roles and data removed.`)
        .setColor(0x00bfff)
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }

    return interaction.editReply({ content: `✅ All strikes removed from <@${user.id}>.` });
  }
};
