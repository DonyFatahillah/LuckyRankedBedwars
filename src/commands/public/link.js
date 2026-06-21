const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const PendingLink = require('../../models/PendingLinkSchema');
const Player = require('../../models/Player');

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
    const pending = await PendingLink.findOne({ linkCode: inputCode });

    if (!pending) {
      return interaction.editReply({
        content: '❌ **Invalid or expired code.** Please type `/link` in-game to get a new code.'
      });
    }

    // 2. Load or create player and set username
    const player = await Player.load(interaction.member);
    await player.setIngameUsername(pending.username);

    // 3. Assign Role (Verified Role ID)
    const verifiedRoleId = '1401289452633985086'; // Verified/Iron role ID
    try {
      await interaction.member.roles.add(verifiedRoleId);
    } catch (err) {
      console.error('[Link] Failed to add role:', err);
    }

    // 4. Update Nickname (using Player.setNickname)
    await player.setNickname();

    // 5. Delete the pending link
    await PendingLink.deleteOne({ _id: pending._id });

    const embed = new EmbedBuilder()
      .setTitle('✅ Account Linked!')
      .setDescription(`Successfully linked to Minecraft account: **${pending.username}**`)
      .setColor(0x00FF00)
      .setThumbnail(`https://mc-heads.net/avatar/${pending.username}/100`);

    await interaction.editReply({ embeds: [embed] });
  }
};
