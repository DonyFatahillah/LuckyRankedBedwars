const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');
const Player = require('../../models/Player');

require('dotenv').config();

const NITRO_ROLE_ID = process.env.NITRO_ROLE_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const ROLE1 = process.env.CHAMPIONS_ROLE_ID;
const ROLE2 = process.env.MEDIA_ROLE_ID;
const ROLE3 = process.env.PROS_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('Toggle your ELO prefix in nickname')
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Enable or disable your prefix')
        .setRequired(true)
        .addChoices(
          { name: 'Enable', value: 'enable' },
          { name: 'Disable', value: 'disable' }
        )
    )
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Optional: Target user (admin only)')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'user') return;

    const query = focused.value.toLowerCase();
    const choices = interaction.guild.members.cache
      .filter(m => m.user.username.toLowerCase().includes(query))
      .map(m => ({
        name: m.user.username,
        value: m.id
      }))
      .slice(0, 25);

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const mode = interaction.options.getString('mode');
    const targetUser = interaction.options.getUser('user');
    const actor = interaction.member;

    const member = targetUser
      ? await interaction.guild.members.fetch(targetUser.id)
      : actor;

    // 🔐 Permission check
    const isAdmin = actor.permissions.has(PermissionFlagsBits.Administrator);
    const hasRole = r => actor.roles.cache.has(r);

    const isAllowed = isAdmin || hasRole(STAFF_ROLE_ID) || hasRole(NITRO_ROLE_ID) || hasRole(ROLE1) || hasRole(ROLE2) || hasRole(ROLE3);

    if (!targetUser && !isAllowed) {
      return interaction.reply({ content: '❌ You do not have permission to toggle prefix.', ephemeral: true });
    }

    if (targetUser && actor.id !== targetUser.id && !isAdmin) {
      return interaction.reply({ content: '❌ Only admins can change other users’ prefix.', ephemeral: true });
    }

    // 🔄 Update preference
    const player = new Player(member);
    const cleanName = member.displayName.replace(/^\[\d+\]\s*/, '').split(' ')[0];

    if (mode === 'disable') {
      await player.setPrefixEnabled(false);
      await member.setNickname(cleanName).catch(() => {});
      return interaction.reply({ content: `✅ Prefix disabled for <@${member.id}>.`, ephemeral: true });
    }

    if (mode === 'enable') {
      await player.setPrefixEnabled(true);
      return interaction.reply({ content: `✅ Prefix enabled for <@${member.id}>.`, ephemeral: true });
    }
  }
};
