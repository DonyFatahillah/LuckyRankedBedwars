const {
  SlashCommandBuilder,
  AttachmentBuilder,
} = require('discord.js');

const { getActiveGames } = require('../../queue/queueManager');
const { isAutoConfirmEnabled } = require('../../utils/autoConfirmManager');
const autoConfirmMatch = require('../../utils/autoConfirmMatch');
const {
  editLogEmbed,
  updateMatchDetails,
  getLogs
} = require('../../utils/matchLogger');
const Player = require('../../models/Player');
require('dotenv').config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit match result screenshot')
    .addAttachmentOption(option =>
      option.setName('screenshot')
        .setDescription('Screenshot proof of match result')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('winbedbreaker')
        .setDescription('Winning team\'s bedbreaker')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('topkillname')
        .setDescription('Player with the most kills (MVP)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option.setName('killamount')
        .setDescription('Amount of kills by the top killer')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('losebedbreaker')
        .setDescription('Losing team\'s bedbreaker (if any)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const screenshot = interaction.options.getAttachment('screenshot');
    const winBedbreakerUsername = interaction.options.getString('winbedbreaker');
    const loseBedbreakerUsername = interaction.options.getString('losebedbreaker');
    const topkillerUsername = interaction.options.getString('topkillname');
    const killamount = interaction.options.getInteger('killamount');
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (screenshot.size > 25 * 1024 * 1024) {
      return await interaction.editReply({
        content: '❌ Screenshot file is too large (max 25MB). Please upload a smaller file.',
      });
    }

    const activeGames = getActiveGames();
    const staffChannelId = process.env.STAFF_VERIFY_CHANNEL_ID;
    const entries = Array.from(activeGames.entries()).reverse();
    const matchLogs = getLogs();

    for (const [gameId, matchData] of entries) {
      const isInCorrectChannel =
        matchData.textChannelId === channelId ||
        matchData.voiceChannelIds?.includes(channelId);
      if (!isInCorrectChannel) continue;

      if (matchLogs[gameId]?.submitted) {
        return await interaction.editReply({
          content: `⚠️ Match #${gameId} has already been submitted.`,
        });
      }

      const staffChannel = await interaction.guild.channels.fetch(staffChannelId).catch(() => null);
      if (!staffChannel) {
        return await interaction.editReply({
          content: '❌ Could not find staff verification channel.',
        });
      }

      const team1Mentions = matchData.teams?.[0]?.map(id => `<@${id}>`).join(', ') || 'N/A';
      const team2Mentions = matchData.teams?.[1]?.map(id => `<@${id}>`).join(', ') || 'N/A';

      const statusRaw = matchLogs[gameId]?.status || 'pending';
      const status = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);

      const allPlayerIds = [...(matchData.teams[0] || []), ...(matchData.teams[1] || [])];
      const members = await Promise.all(
        allPlayerIds.map(id => interaction.guild.members.fetch(id).catch(() => null))
      );

      let winBedbreakerMention = winBedbreakerUsername;
      let loseBedbreakerMention = loseBedbreakerUsername || null;
      let topkillerMention = topkillerUsername;
      let winTeam = null;

      for (const member of members.filter(Boolean)) {
        const player = new Player(member);
        await player.getStats(); // no-op, just for clarity
        const username = player.username?.toLowerCase();

        if (username === winBedbreakerUsername.toLowerCase()) {
          winBedbreakerMention = `<@${member.id}>`;
          winTeam = matchData.teams[0]?.includes(member.id) ? 'team1' : 'team2';
        }
        if (loseBedbreakerUsername && username === loseBedbreakerUsername.toLowerCase()) {
          loseBedbreakerMention = `<@${member.id}>`;
        }
        if (username === topkillerUsername.toLowerCase()) {
          topkillerMention = `<@${member.id}>`;
        }
      }

      let message = `📤 Match **#${gameId}** result submitted by <@${userId}>\n`;
      message += `🔨 **Winning Bedbreaker:** ${winBedbreakerMention}\n`;
      if (loseBedbreakerMention) {
        message += `🔨 **Losing Bedbreaker:** ${loseBedbreakerMention}\n`;
      }
      message += `⚔️ **MVP:** ${topkillerMention} (${killamount} kills)\n`;
      message += `📝 **Status:** ${status}\n\n`;
      message += `🟥 **Team 1:** ${team1Mentions}\n`;
      message += `🟦 **Team 2:** ${team2Mentions}\n`;
      message += `> Note for the staff team, the MVP is the topkiller. If the topkiller is on the losing team,\n`;
      message += `> still confirm with the same MVP player.\n`;

      const sentMessage = await staffChannel.send({
        content: message,
        files: [new AttachmentBuilder(screenshot.url)],
      });

      updateMatchDetails(gameId, {
        submitted: true,
        topKiller: topkillerMention,
        kills: killamount,
        winBedbreaker: winBedbreakerMention,
        loseBedbreaker: loseBedbreakerMention,
        messageId: sentMessage.id
      });

      await editLogEmbed(interaction.client, interaction.guild.id, gameId, staffChannelId, 'pending', {
        bedbreaker: winBedbreakerMention,
        loseBedbreaker: loseBedbreakerMention,
        topKiller: topkillerMention,
        kills: killamount,
      });

      if (isAutoConfirmEnabled() && winTeam) {
        try {
          await autoConfirmMatch(interaction.client, interaction.guild, gameId, {
            winner: winTeam,
            winBedbreaker: winBedbreakerUsername,
            loseBedbreaker: loseBedbreakerUsername,
            topKiller: topkillerUsername
          });
        } catch (e) {
          console.error(`[Submit] autoConfirmMatch failed: ${e.stack}`);
        }
      }

      try {
        return await interaction.editReply({
          content: `✅ Match #${gameId} result submitted. Staff has been notified.`,
        });
      } catch (err) {
        console.warn(`[Submit] Failed to edit reply: ${err.message}`);
        if (err.code === 10008) {
          return await interaction.followUp({
            content: `✅ Match #${gameId} result submitted. Staff has been notified.`,
            ephemeral: true
          }).catch(() => {});
        }
      }
    }

    return await interaction.editReply({
      content: '❌ You are not currently submitting from a valid match channel.',
    });
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const channelId = interaction.channelId;
    const activeGames = getActiveGames();

    let gameId = null;
    let match = null;

    for (const [id, m] of activeGames.entries()) {
      const isInCorrectChannel = m.textChannelId === channelId || m.voiceChannelIds?.includes(channelId);
      if (isInCorrectChannel) {
        gameId = id;
        match = m;
        break;
      }
    }

    if (!match) return interaction.respond([]);

    const allPlayerIds = [...(match.teams?.[0] || []), ...(match.teams?.[1] || [])];
    const members = await Promise.all(
      allPlayerIds.map(id => interaction.guild.members.fetch(id).catch(() => null))
    );

    const suggestions = await Promise.all(
      members
        .filter(Boolean)
        .map(async member => {
          const player = new Player(member);
          await player.getStats(); // no-op, for clarity
          return {
            name: player.username,
            value: player.username
          };
        })
    );

    const filtered = suggestions
      .filter(s => s.name?.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25);

    return interaction.respond(filtered);
  }
};
