const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} = require('discord.js');
require('dotenv').config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Submit a verification request')
    .addStringOption(option =>
      option
        .setName('nickname')
        .setDescription('Your in-game nickname')
        .setRequired(true)
    )
    .addAttachmentOption(option =>
      option
        .setName('screenshot')
        .setDescription('Screenshot proof')
        .setRequired(true)
    ),

  async execute(interaction) {
    const allowedChannelId = process.env.VERIFICATION_CHANNEL_ID;

    if (interaction.channelId !== allowedChannelId) {
      return interaction.reply({
        content: `❌ This command can only be used in <#${allowedChannelId}>.`,
        ephemeral: true,
      });
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      const nickname = interaction.options.getString('nickname');
      const screenshot = interaction.options.getAttachment('screenshot');

      if (!screenshot || !screenshot.url) {
        return await interaction.editReply({ content: '❌ Invalid screenshot provided.' });
      }

      const staffChannelId = process.env.STAFF_CHANNEL_ID;
      if (!staffChannelId) {
        return await interaction.editReply({ content: '❌ Staff channel ID not configured in .env' });
      }

      const staffChannel = await interaction.client.channels.fetch(staffChannelId).catch(() => null);
      if (!staffChannel || !staffChannel.isTextBased()) {
        return await interaction.editReply({ content: '❌ Staff channel is missing or not a text channel.' });
      }

      const embed = new EmbedBuilder()
        .setTitle('📝 New Verification Request')
        .addFields(
          { name: 'User', value: `${interaction.user} (${interaction.user.id})`, inline: false },
          { name: 'Nickname', value: `\`${nickname}\``, inline: false }
        )
        .setImage(screenshot.url)
        .setColor('Blue')
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`verify-approve-${interaction.user.id}-${nickname}`)
          .setLabel('✅ Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`verify-deny-${interaction.user.id}-${nickname}`)
          .setLabel('❌ Deny')
          .setStyle(ButtonStyle.Danger)
      );

      await staffChannel.send({ embeds: [embed], components: [row] });

      return await interaction.editReply({
        content: '✅ Your verification request has been sent to staff.',
      });
    } catch (error) {
      console.error('[Verify] Error:', error);

      const failMessage = '❌ Something went wrong while processing your request.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: failMessage }).catch(() => {});
      } else {
        await interaction.reply({ content: failMessage, ephemeral: true }).catch(() => {});
      }
    }
  },
};
