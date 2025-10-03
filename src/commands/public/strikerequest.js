const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const path = require('path');
const fs = require('fs');
const { getActiveGames } = require('../../queue/queueManager');
const Player = require('../../models/Player');
const matchLogPath = path.join(__dirname, '../../../data/matchLogs.json');
const strikePath = path.join(__dirname, '../../../data/strikes.json');
require('dotenv').config();

// ✅ Helpers
function loadMatchLogs() {
  try {
    return JSON.parse(fs.readFileSync(matchLogPath, 'utf-8'));
  } catch {
    return {};
  }
}

function loadStrikes() {
  try {
    return JSON.parse(fs.readFileSync(strikePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStrikes(data) {
  fs.writeFileSync(strikePath, JSON.stringify(data, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('strike')
    .setDescription('Request a strike against a player')
    .addSubcommand(sub =>
      sub.setName('request')
        .setDescription('Request a strike')
        .addUserOption(opt =>
          opt.setName('player')
            .setDescription('Player to strike')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('gameid')
            .setDescription('Match ID (recently played)')
            .setRequired(true)
            .setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('Reason for the strike')
            .setRequired(true))
        .addAttachmentOption(opt =>
          opt.setName('screenshot')
            .setDescription('Screenshot or evidence (optional)')
            .setRequired(false))
    ),

  // ✅ Autocomplete for match IDs based on recentlyPlayed
  autocomplete: async function (interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'gameid') return;

    const player = interaction.options.getUser('player');
    if (!player) {
      return interaction.respond([
        { name: '❌ Please select a player first.', value: 'N/A' }
      ]);
    }

    const matchLogs = loadMatchLogs();
    const p = new Player(player);
    await p.load(); // Ensure data is loaded from storage
    const recent = p.recentlyPlayed || [];

    const suggestions = recent
      .filter(id => matchLogs[id] && ['pending', 'confirmed'].includes(matchLogs[id].status))
      .map(id => ({
        name: `#${id}`,
        value: id
      }))
      .filter(s => s.name.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25);

    await interaction.respond(suggestions);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'request') return;

    const gameId = interaction.options.getString('gameid').toUpperCase();
    const player = interaction.options.getUser('player');
    const reason = interaction.options.getString('reason');
    const attachment = interaction.options.getAttachment('screenshot');

    const matchLogs = loadMatchLogs();
    const match = matchLogs[gameId];

    if (!match) {
      return await interaction.reply({
        content: `❌ Match \`${gameId}\` not found.`,
        ephemeral: true,
      });
    }

    const team1 = match.team1 || [];
    const team2 = match.team2 || [];

    let team;
    if (team1.includes(player.id)) team = 'team1';
    else if (team2.includes(player.id)) team = 'team2';
    else {
      return await interaction.reply({
        content: `❌ ${player} was not part of match \`${gameId}\`.`,
        ephemeral: true,
      });
    }

    const strikes = loadStrikes();
    if (!strikes[gameId]) strikes[gameId] = {};

    if (strikes[gameId][player.id]) {
      return await interaction.reply({
        content: `❌ A strike for ${player} has already been requested in match \`${gameId}\`.`,
        ephemeral: true,
      });
    }

    // Save strike entry
    strikes[gameId][player.id] = {
      reason,
      requestedBy: interaction.user.id,
      team,
      vouches: [],
      screenshot: attachment?.url || null,
    };
    saveStrikes(strikes);

    const strikeLogChannel = await interaction.guild.channels.fetch(process.env.STRIKE_LIST_CHANNEL_ID).catch(() => null);
    if (!strikeLogChannel) {
      return await interaction.reply({
        content: '❌ Could not find strike log channel.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🚨 Strike Requested')
      .setDescription([
        `**Match:** #${gameId}`,
        `**Striked:** <@${player.id}>`,
        `**Team:** ${team.toUpperCase()}`,
        `**Requested by:** <@${interaction.user.id}>`,
        `**Reason:** ${reason}`
      ].join('\n'))
      .setColor('Red')
      .setTimestamp();

    if (attachment) {
      embed.setImage(attachment.url);
    }

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`strike-vouch-${gameId}-${player.id}`)
        .setLabel('👍 Vouch')
        .setStyle(ButtonStyle.Success)
    );

    await strikeLogChannel.send({ embeds: [embed], components: [buttonRow] });

    await interaction.reply({
      content: `✅ Strike request for ${player} in match \`${gameId}\` submitted.`,
      ephemeral: true,
    });
  }
};
