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
        flags: [64]
      });
    }

    await interaction.deferReply({ flags: [64] });

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return await interaction.editReply({ content: '❌ Could not find the user.' });
    }

    const verifiedRoleId = process.env.VERIFIED_ROLE_ID || '1401289452633985086';
    const alreadyVerified = verifiedRoleId && member.roles.cache.has(verifiedRoleId);

    // 🛑 Prevent repeated verification
    if (action === 'approve' && alreadyVerified) {
      await interaction.editReply({
        content: `❌ This user is already verified.`
      });
      return disableButtons(interaction.message);
    }

    // 🛑 Prevent repeated denial
    if (action === 'deny') {
      // Optional: tag users as "denied" using a role or nickname suffix if needed
      await interaction.editReply({
        content: `❌ This user is already denied or not eligible.`
      });
      return disableButtons(interaction.message);
    }

    if (action === 'approve') {
      const player = await Player.load(member);
      const cleanNickname = nickname.trim();

      await player.setIngameUsername(cleanNickname);
      await player.setElo(0);

      const verifiedRole = verifiedRoleId ? await interaction.guild.roles.fetch(verifiedRoleId).catch(() => null) : null;
      if (verifiedRole) {
        await member.roles.add(verifiedRole).catch(err => console.error(`[Verify] Failed to add role: ${err.message}`));
      } else {
        console.warn(`[Verify] Verified role not found: ${verifiedRoleId}`);
      }

      await interaction.editReply({
        content: `✅ ${member} has been verified and renamed to **[${player.elo}] ${cleanNickname}**.`
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
