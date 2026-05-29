const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const PunishmentModel = require('../../models/PunishmentSchema');
require('dotenv').config();

const PUNISHMENT_LOGS_CHANNEL_ID = process.env.PUNISHMENT_LOGS_CHANNEL_ID;
const RANKED_BANNED_ROLE_ID = process.env.RANKED_BANNED_ROLE_ID;

const STRIKE_ROLES = [
  process.env.STRIKE_I_ROLE_ID,
  process.env.STRIKE_II_ROLE_ID,
  process.env.STRIKE_III_ROLE_ID
];

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

    // Remove strike roles
    for (const roleId of STRIKE_ROLES) {
      if (roleId && member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => {});
      }
    }

    // Remove ranked banned role
    if (RANKED_BANNED_ROLE_ID && member.roles.cache.has(RANKED_BANNED_ROLE_ID)) {
      await member.roles.remove(RANKED_BANNED_ROLE_ID).catch(() => {});
    }

    // Remove from MongoDB
    await PunishmentModel.deleteMany({ userId: user.id });

    const logChannel = await interaction.guild.channels.fetch(PUNISHMENT_LOGS_CHANNEL_ID).catch(() => null);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setTitle('🧹 Strike/Ban Cleared')
        .setDescription(`<@${user.id}> has had all strike/ban roles and data removed.`)
        .setColor(0x00bfff)
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }

    return interaction.editReply({ content: `✅ All strikes/bans removed from <@${user.id}>.` });
  }
};
