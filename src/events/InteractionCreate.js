const { Events, PermissionFlagsBits, ButtonStyle, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const Player = require('../models/Player');
require('dotenv').config({ path: __dirname + '/../.env' });

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    if (!interaction.isButton()) return;

    const [prefix, action, userId, ...nicknameParts] = interaction.customId.split('-');
    const nickname = nicknameParts.join('-');

    if (prefix !== 'verify') return;

    // ✅ Restrict button use to admins only
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: '❌ You do not have permission to use this button.',
        ephemeral: true
      });
    }

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return await interaction.reply({ content: '❌ Could not find the user.', ephemeral: true });
    }

    const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
    const alreadyVerified = verifiedRoleId && member.roles.cache.has(verifiedRoleId);

    // 🛑 Prevent repeated verification
    if (action === 'approve' && alreadyVerified) {
      await interaction.reply({
        content: `❌ This user is already verified.`,
        ephemeral: true
      });
      return disableButtons(interaction.message);
    }

    // 🛑 Prevent repeated denial
    if (action === 'deny') {
      // Optional: tag users as "denied" using a role or nickname suffix if needed
      await interaction.reply({
        content: `❌ This user is already denied or not eligible.`,
        ephemeral: true
      });
      return disableButtons(interaction.message);
    }

    if (action === 'approve') {
      const player = new Player(member);
      const cleanNickname = nickname.trim();

      player.setElo(0);
      await player.setNickname(cleanNickname, true);

      if (verifiedRoleId && interaction.guild.roles.cache.has(verifiedRoleId)) {
        await member.roles.add(verifiedRoleId).catch(console.error);
      }

      await interaction.reply({
        content: `✅ ${member} has been verified and renamed to **[${player.elo}] ${cleanNickname}**.`,
        ephemeral: true
      });

      return disableButtons(interaction.message);
    }
  }
};

// 🔧 Disable buttons on the original message
async function disableButtons(message) {
  if (!message.editable) return;

  const disabledComponents = message.components.map(row => {
    const newRow = new ActionRowBuilder();
    row.components.forEach(component => {
      newRow.addComponents(
        ButtonBuilder.from(component).setDisabled(true)
      );
    });
    return newRow;
  });

  await message.edit({ components: disabledComponents }).catch(console.error);
}
