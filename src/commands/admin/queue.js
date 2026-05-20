// src/commands/moderation/queue.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const queueVoiceChannels = [
  process.env.QUEUE_ALL_RANK_4V4_ID,
  process.env.QUEUE_0_600_3V3_ELO_VOICE_ID,
  process.env.QUEUE_0_600_4V4_ELO_VOICE_ID,
  process.env.QUEUE_600_PLUS_3V3_ELO_VOICE_ID,
  process.env.QUEUE_600_PLUS_4V4_ELO_VOICE_ID,
  process.env.QUEUE_PREMIUM_VOICE_ID
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Open or close the Ranked Bedwars queue')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('state')
        .setDescription('Open or close the queue')
        .setRequired(true)
        .addChoices(
          { name: 'Open', value: 'open' },
          { name: 'Close', value: 'close' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const state = interaction.options.getString('state');
    const isOpen = state === 'open';
    const newLimit = isOpen ? 0 : 1; // 0 = infinite, 1 = closed for new joins

    let updatedChannels = 0;

    for (const channelId of queueVoiceChannels) {
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== 2) continue; // skip if not voice
      await channel.edit({ userLimit: newLimit }).catch(() => {});
      updatedChannels++;
    }

    return interaction.editReply({
      content: isOpen
        ? `✅ Ranked queue is now **OPEN**! `
        : `⛔ Ranked queue is now **CLOSED**! `,
      ephemeral: false
    });
  }
};
