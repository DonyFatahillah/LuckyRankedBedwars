const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const path = require('path');
const fs = require('fs');
const Player = require('../../models/Player');
const { getMatchLog } = require('../../utils/matchLogger');
require('dotenv').config();

const strikePath = path.join(__dirname, '../../../data/strikes.json');

// Helper: load strikes
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

  // ✅ Autocomplete match ID based on selected player's recent matches
  autocomplete: async function (interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'gameid') return;

    // Extract user ID from raw options
    const subOptions = interaction.options.data.find(opt => opt.name === 'request')?.options || [];
    const playerOption = subOptions.find(opt => opt.name === 'player');
    const playerId = playerOption?.value;

    if (!playerId) {
      return interaction.respond([{ name: '❌ Please select a player first.', value: 'N/A' }]);
    }

    const member = await interaction.guild.members.fetch(playerId).catch(() => null);
    if (!member) {
      return interaction.respond([{ name: '❌ Could not find that player.', value: 'N/A' }]);
    }

    const player = await Player.load(member);
    const recent = player.recentlyPlayed || [];

    const suggestions = [];
    for (const id of recent) {
      const match = await getMatchLog(id);
      if (match && ['pending', 'confirmed'].includes(match.status)) {
        if (id.toLowerCase().includes(focused.value.toLowerCase())) {
          suggestions.push({ name: `#${id}`, value: id });
        }
      }
    }
    await interaction.respond(suggestions.slice(0, 25));
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'request') return;

    const gameId = interaction.options.getString('gameid').toUpperCase();
    const targetUser = interaction.options.getUser('player');
    const reason = interaction.options.getString('reason');
    const attachment = interaction.options.getAttachment('screenshot');

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return await interaction.reply({
        content: '❌ Unable to find that player in this server.',
        ephemeral: true,
      });
    }

    const targetPlayer = await Player.load(member);
    const username = targetPlayer.username;

    const match = await getMatchLog(gameId);

    if (!match) {
      return await interaction.reply({
        content: `❌ Match \`${gameId}\` not found.`,
        ephemeral: true,
      });
    }

    const team1 = match.team1 || match.winners || [];
    const team2 = match.team2 || match.losers || [];

    let team;
    if (team1.includes(targetUser.id)) team = 'team1';
    else if (team2.includes(targetUser.id)) team = 'team2';
    else {
      return await interaction.reply({
        content: `❌ ${targetUser} was not part of match \`${gameId}\`.`,
        ephemeral: true,
      });
    }

    const strikes = loadStrikes();
    if (!strikes[gameId]) strikes[gameId] = {};

    if (strikes[gameId][targetUser.id]) {
      return await interaction.reply({
        content: `❌ A strike for ${targetUser} has already been requested in match \`${gameId}\`.`,
        ephemeral: true,
      });
    }

    // ✅ Save strike
    strikes[gameId][targetUser.id] = {
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
        `**Striked:** ${username} (<@${targetUser.id}>)`,
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
        .setCustomId(`strike-vouch-${gameId}-${targetUser.id}`)
        .setLabel('👍 Vouch')
        .setStyle(ButtonStyle.Success)
    );

    await strikeLogChannel.send({ embeds: [embed], components: [buttonRow] });

    await interaction.reply({
      content: `✅ Strike request for ${username} in match \`${gameId}\` submitted.`,
      ephemeral: true,
    });
  }
};
