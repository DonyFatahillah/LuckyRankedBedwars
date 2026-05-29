const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const PunishmentModel = require('../../models/PunishmentSchema');
require('dotenv').config();

const STRIKE_ROLES = [
  process.env.STRIKE_I_ROLE_ID,
  process.env.STRIKE_II_ROLE_ID,
  process.env.STRIKE_III_ROLE_ID
];

const RANKED_BANNED_ROLE_ID = process.env.RANKED_BANNED_ROLE_ID;
const PUNISHMENT_LOGS_CHANNEL_ID = process.env.PUNISHMENT_LOGS_CHANNEL_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('strikeplayer')
    .setDescription('Give a strike to a member (escalates from I to III)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('member')
        .setDescription('The member to strike')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the strike (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const member = interaction.options.getMember('member');
    const reason = interaction.options.getString('reason')?.trim()
      || 'The player has been striked due to a violation to the rules.';

    if (!member) return interaction.editReply({ content: '❌ Member not found.', ephemeral: true });

    // Clean up expired punishments
    await PunishmentModel.deleteMany({ userId: member.id, type: 'strike', expiresAt: { $lte: new Date() } });
    
    const expiredBan = await PunishmentModel.findOneAndDelete({ userId: member.id, type: 'ban', expiresAt: { $lte: new Date() } });
    if (expiredBan) {
      await member.roles.remove(RANKED_BANNED_ROLE_ID).catch(() => {});
    }

    let currentStrikeLevel = 0;
    for (let i = STRIKE_ROLES.length - 1; i >= 0; i--) {
      if (member.roles.cache.has(STRIKE_ROLES[i])) {
        currentStrikeLevel = i + 1;
        break;
      }
    }

    if (currentStrikeLevel >= STRIKE_ROLES.length) {
      return interaction.editReply({
        content: `⚠️ ${member} already has the highest strike level (III).`,
        ephemeral: true
      });
    }

    const nextStrikeLevel = currentStrikeLevel + 1;
    const nextRoleId = STRIKE_ROLES[nextStrikeLevel - 1];
    const nextLabel = ['I', 'II', 'III'][nextStrikeLevel - 1];

    try {
      await member.roles.add(nextRoleId);
      
      const newStrike = await PunishmentModel.create({
        userId: member.id,
        type: 'strike',
        level: nextStrikeLevel,
        expiresAt: new Date(Date.now() + 7 * 86400000) // 7 days
      });

      let banDurationDays = 0;
      if (nextStrikeLevel === 2) banDurationDays = 3;
      if (nextStrikeLevel === 3) banDurationDays = 7;

      let newBan = null;
      if (banDurationDays > 0) {
        newBan = await PunishmentModel.create({
          userId: member.id,
          type: 'ban',
          expiresAt: new Date(Date.now() + banDurationDays * 86400000)
        });
        await member.roles.add(RANKED_BANNED_ROLE_ID);
      }

      await interaction.editReply({
        content: `✅ ${member} has been given **Strike ${nextLabel}**.`,
        ephemeral: false
      });

      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Strike ${nextLabel} Issued`)
        .addFields(
          { name: 'Member', value: `${member}`, inline: true },
          { name: 'Strike Level', value: nextLabel, inline: true },
          { name: 'Expires At', value: `<t:${Math.floor(newStrike.expiresAt.getTime() / 1000)}:R>`, inline: true },
          { name: '📄 Reason', value: reason }
        )
        .setColor(nextStrikeLevel === 3 ? 0xff0000 : 0xffa500)
        .setTimestamp();

      if (banDurationDays > 0) {
        embed.addFields({
          name: '🚫 Ranked Ban',
          value: `Applied for ${banDurationDays} days. Expires <t:${Math.floor(newBan.expiresAt.getTime() / 1000)}:R>`
        });
      } else {
        embed.addFields({
          name: 'ℹ️ Note',
          value: `Strike I has no ranked ban and will auto-expire in 7 days.`
        });
      }

      const logChannel = await interaction.guild.channels.fetch(PUNISHMENT_LOGS_CHANNEL_ID).catch(() => null);
      if (logChannel) await logChannel.send({ embeds: [embed] });

    } catch (err) {
      console.error('[Strike] Failed to apply:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Failed to assign strike. Check bot permissions.', ephemeral: true });
      } else {
        await interaction.editReply({ content: '❌ Failed to assign strike. Check bot permissions.', ephemeral: true });
      }
    }
  }
};
