const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');
require('dotenv').config();

const NITRO_ROLE_ID = process.env.NITRO_ROLE_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const ROLE1 = process.env.CHAMPIONS_ROLE_ID;
const ROLE2 = process.env.MEDIA_ROLE_ID;
const ROLE3 = process.env.PROS_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nickname')
    .setDescription('Change your nickname (respects ELO prefix setting)')
    .addStringOption(opt =>
      opt.setName('newnick')
        .setDescription('Your new nickname (no prefix)')
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Optional: Target user (admin only)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const actor = interaction.member;
    const newnick = interaction.options.getString('newnick');
    const targetUser = interaction.options.getUser('user');

    const isAdmin = actor.permissions.has(PermissionFlagsBits.Administrator);
    const hasRole = r => actor.roles.cache.has(r);
    const isAllowed =
      isAdmin ||
      hasRole(STAFF_ROLE_ID) ||
      hasRole(NITRO_ROLE_ID) ||
      hasRole(ROLE1) ||
      hasRole(ROLE2) ||
      hasRole(ROLE3);

    if (!isAllowed) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command.',
        ephemeral: true
      });
    }

    const targetMember = targetUser
      ? await interaction.guild.members.fetch(targetUser.id).catch(() => null)
      : actor;

    if (!targetMember) {
      return interaction.reply({
        content: '❌ Could not find the specified member.',
        ephemeral: true
      });
    }

    if (targetUser && actor.id !== targetUser.id && !isAdmin) {
      return interaction.reply({
        content: '❌ Only admins can change nicknames for others.',
        ephemeral: true
      });
    }

    const player = new Player(targetMember);

    try {
      if (player.prefixEnabled) {
        // Use numeric ELO as prefix
        await player.setNickname(newnick, true);
      } else {
        // Plain nickname without prefix
        await player.setDisplayName(newnick);
      }

      return interaction.reply({
        content: `✅ Display name updated for <@${targetMember.id}> to \`${targetMember.displayName}\`.`,
        ephemeral: true
      });
    } catch (err) {
      console.warn(`[nickname] Failed to set nickname for ${targetMember.id}:`, err.message);
      return interaction.reply({
        content: '❌ Failed to change nickname (maybe insufficient permissions).',
        ephemeral: true
      });
    }
  }
};
