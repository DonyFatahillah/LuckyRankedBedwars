const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LOG_PATH = path.join(__dirname, '../../../data/screenshareLogs.json');

function loadLogs() {
  if (fs.existsSync(LOG_PATH)) return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
  return {};
}

function saveLogs(logs) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ss')
    .setDescription('Manage screenshare requests')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('respond')
        .setDescription('Respond to a screenshare request')
        .addStringOption(opt => opt
          .setName('id')
          .setDescription('Request ID')
          .setRequired(true)
          .setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('close')
        .setDescription('Close a screenshare request')
        .addStringOption(opt => opt
          .setName('id')
          .setDescription('Request ID')
          .setRequired(true)
          .setAutocomplete(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const requestId = interaction.options.getString('id').toUpperCase();
    const logs = loadLogs();
    const log = logs[requestId];

    if (!log) return interaction.reply({ content: `❌ Request ID ${requestId} not found.`, ephemeral: true });

    // -------------------------
    // RESPOND TO SCRENSHARE
    // -------------------------
    if (sub === 'respond') {
      if (log.status !== 'pending') return interaction.reply({ content: `❌ Request ${requestId} is already active or closed.`, ephemeral: true });

      const player = await interaction.guild.members.fetch(log.playerId).catch(() => null);
      const channel = await interaction.guild.channels.fetch(log.channelId).catch(() => null);
      const role = interaction.guild.roles.cache.get(process.env.FROZEN_ROLE_ID);

      if (!player || !channel || !role) return interaction.reply({ content: '❌ Missing player, channel, or frozen role.', ephemeral: true });

      // Assign frozen role
      await player.roles.add(role).catch(() => {});

      // Create voice channel
      const voiceChannel = await interaction.guild.channels.create({
        name: `screenshare-${requestId}-${player.user.username}`,
        type: ChannelType.GuildVoice,
        parent: channel.parentId,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: ['ViewChannel'] },
          { id: player.id, allow: ['ViewChannel', 'Connect', 'Speak'] },
          { id: process.env.STAFF_ROLE_ID, allow: ['ViewChannel', 'Connect', 'Speak'] }
        ]
      });

      await player.voice.setChannel(voiceChannel).catch(() => {});
      log.voiceId = voiceChannel.id;
      log.staffId = interaction.user.id;
      log.status = 'active';
      saveLogs(logs);

      // Track voice movements to keep player in the screenshare VC
      interaction.client.on('voiceStateUpdate', async (oldState, newState) => {
        if (log.status !== 'active') return;
        if (newState.id === player.id && newState.channelId !== log.voiceId) {
          const vc = await interaction.guild.channels.fetch(log.voiceId).catch(() => null);
          if (vc) await player.voice.setChannel(vc).catch(() => {});
        }
      });

      return interaction.reply({ content: `✅ Responded to request ${requestId} and moved player to screenshare voice.`, ephemeral: true });
    }

    // -------------------------
    // CLOSE SCRENSHARE
    // -------------------------
    if (sub === 'close') {
      if (!['pending', 'active'].includes(log.status)) return interaction.reply({ content: `❌ Request ${requestId} is already closed.`, ephemeral: true });

      const player = await interaction.guild.members.fetch(log.playerId).catch(() => null);
      const textChannel = await interaction.guild.channels.fetch(log.channelId).catch(() => null);
      const voiceChannel = log.voiceId ? await interaction.guild.channels.fetch(log.voiceId).catch(() => null) : null;
      const archivedCategory = await interaction.guild.channels.fetch(process.env.SS_ARCHIVE_CATEGORY_ID).catch(() => null);
      const role = interaction.guild.roles.cache.get(process.env.FROZEN_ROLE_ID);

      // Remove frozen role if applied
      if (player && role && player.roles.cache.has(role.id)) {
        await player.roles.remove(role).catch(() => {});
      }

      // Archive text channel
      if (textChannel && archivedCategory) {
        await textChannel.setParent(archivedCategory.id).catch(() => {});
        await textChannel.setName(`archived-${textChannel.name}`).catch(() => {});
      }

      // Archive voice channel if exists
      if (voiceChannel && archivedCategory) {
        await voiceChannel.setParent(archivedCategory.id).catch(() => {});
        await voiceChannel.setName(`archived-${voiceChannel.name}`).catch(() => {});
      }

      log.status = 'closed';
      saveLogs(logs);

      return interaction.reply({ content: `✅ Screenshare request ${requestId} has been closed and archived.`, ephemeral: true });
    }
  },

  // -------------------------
  // AUTOCOMPLETE
  // -------------------------
  autocomplete: async (interaction) => {
    const focused = interaction.options.getFocused();
    const sub = interaction.options.getSubcommand();
    const logs = loadLogs();

    let choices = Object.keys(logs);

    if (sub === 'respond') {
      choices = choices.filter(id => logs[id].status === 'pending');
    } else if (sub === 'close') {
      choices = choices.filter(id => ['pending', 'active'].includes(logs[id].status));
    }

    const filtered = choices
      .filter(id => id.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25)
      .map(id => ({ name: id, value: id }));

    return interaction.respond(filtered);
  }
};
