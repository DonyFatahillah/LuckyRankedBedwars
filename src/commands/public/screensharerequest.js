const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LOG_PATH = path.join(__dirname, '../../../data/screenshareLogs.json');
let logs = {};
if (fs.existsSync(LOG_PATH)) logs = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));

function saveLogs() {
  fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('screenshare')
    .setDescription('Screenshare management commands')
    .addSubcommand(sub =>
      sub.setName('request')
        .setDescription('Request a screenshare')
        .addUserOption(opt => opt.setName('player').setDescription('Player to screenshare').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true))
        .addAttachmentOption(opt => opt.setName('media').setDescription('Image/Video evidence').setRequired(true))
        .addStringOption(opt => opt.setName('link').setDescription('Optional media link').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'request') return;

    const player = interaction.options.getUser('player');
    const reason = interaction.options.getString('reason');
    const media = interaction.options.getAttachment('media');
    const link = interaction.options.getString('link');

    const requestId = `SS${Math.floor(Math.random() * 9000 + 1000)}`;

    // Embed for request
    const embed = new EmbedBuilder()
      .setTitle(`📢 Screenshare Request: ${requestId}`)
      .setDescription([
        `👤 Player: ${player.tag}`,
        `📝 Reason: ${reason}`,
        link ? `🔗 Link: ${link}` : null
      ].filter(Boolean).join('\n'))
      .setColor(0xffa500)
      .setTimestamp();

    // Display media properly
    if (media.contentType?.startsWith('image/')) {
      embed.setImage(media.url); // show image directly
    } else if (media.contentType?.startsWith('video/')) {
      embed.addFields({ name: '📎 Video', value: `[Click to view](${media.url})` }); // video as link
    }

    // Send to request & staff channels
    const requestChannel = await interaction.guild.channels.fetch(process.env.SCREENSHARE_REQUEST_CHANNEL_ID).catch(() => null);
    const staffChannel = await interaction.guild.channels.fetch(process.env.SCREENSHARE_STAFF_CHANNEL_ID).catch(() => null);

    if (requestChannel) await requestChannel.send({ embeds: [embed] }).catch(() => {});
    if (staffChannel) await staffChannel.send({ embeds: [embed] }).catch(() => {});

    // Create temporary text channel
    const category = await interaction.guild.channels.fetch(process.env.SCREENSHARE_CATEGORY_ID).catch(() => null);
    const tempChannel = await interaction.guild.channels.create({
      name: `screenshare-${requestId}-${player.username}`,
      type: ChannelType.GuildText,
      parent: category ? category.id : null,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: ['ViewChannel'] }, // hide for everyone
        { id: player.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        { id: process.env.STAFF_ROLE_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
      ]
    });

    // Send mention message in the channel
    await tempChannel.send({
      content: `📢 Screenshare request created!\n${player} (suspected player) and <@&${process.env.STAFF_ROLE_ID}> (staff) are notified here.`,
      embeds: [embed]
    }).catch(() => {});

    // Save to logs
    logs[requestId] = {
      playerId: player.id,
      channelId: tempChannel.id,
      reason,
      media: media.url,
      link: link || null,
      createdAt: Date.now(),
      status: 'pending'
    };
    saveLogs();

    // Auto-delete after 1 hour if no staff responds
    setTimeout(async () => {
      const log = logs[requestId];
      if (!log || log.status !== 'pending') return;

      const ch = await interaction.guild.channels.fetch(log.channelId).catch(() => null);
      if (ch) await ch.delete().catch(() => {});

      delete logs[requestId];
      saveLogs();
    }, 60 * 60 * 1000);

    await interaction.reply({ content: `✅ Screenshare request for ${player.tag} submitted with ID ${requestId}.`, ephemeral: true });
  }
};
