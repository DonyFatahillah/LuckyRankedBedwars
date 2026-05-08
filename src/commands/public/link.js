const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const PendingLink = require('../../models/PendingLinkSchema');
const PlayerModel = require('../../models/PlayerSchema');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Connect your Discord to your Minecraft account using a code')
    .addStringOption(option =>
      option.setName('code')
        .setDescription('The 6-digit code generated in Minecraft')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const inputCode = interaction.options.getString('code');

    // 1. Look for the code in PendingLinks
    const pending = await PendingLink.findOne({ linkCode_1: inputCode });

    if (!pending) {
      return interaction.editReply({
        content: '❌ **Invalid or expired code.** Please type `/link` in-game to get a new code.'
      });
    }

    // 2. Update the user's Stats document
    await PlayerModel.findOneAndUpdate(
      { userId: interaction.user.id },
      { 
        ingameUsername: pending.username_1,
        discordUsername: interaction.user.username
      },
      { upsert: true }
    );

    // 3. Assign Verified Role
    const verifiedRoleId = '1401289452633985086';
    try {
      await interaction.member.roles.add(verifiedRoleId);
    } catch (err) {
      console.error('[Link] Failed to add role:', err);
    }

    // 4. Update Nickname
    try {
      await interaction.member.setNickname(pending.username_1);
    } catch (err) {
      console.error('[Link] Failed to set nickname:', err);
    }

    // 5. Delete the pending link so the code can't be used again
    await PendingLink.deleteOne({ _id: pending._id });

    const embed = new EmbedBuilder()
      .setTitle('✅ Account Linked!')
      .setDescription(`Successfully linked to Minecraft account: **${pending.username_1}**`)
      .setColor(0x00FF00)
      .setThumbnail(`https://mc-heads.net/avatar/${pending.username_1}/100`);

    await interaction.editReply({ embeds: [embed] });
  }
};
