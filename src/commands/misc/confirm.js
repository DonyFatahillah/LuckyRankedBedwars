const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');

require('dotenv').config();
const { logStaffCommand } = require('../../utils/staffLogger');
const { getActiveGames, deleteActiveGame } = require('../../queue/queueManager');
const Player = require('../../models/Player');
const { getLogs, updateMatchStatus, editLogEmbed } = require('../../utils/matchLogger');
const { isAllRankQueue } = require('../../config/eloQueues');

const activeConfirmLocks = new Set();

const STAFF_CHANNEL_ID = process.env.STAFF_VERIFY_CHANNEL_ID;
const SCORING_CHANNEL_ID = process.env.SCORING_CHANNEL_ID;
const MATCH_LOGS_ID = process.env.MATCH_LOGS_ID;
const VERIFY_MATCH_CHANNEL_ID = process.env.VERIFY_MATCH_CHANNEL_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confirm')
    .setDescription('Confirm a match result and calculate ELO.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('gameid')
        .setDescription('The 6-character game hex ID (e.g., 6DF4D2)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('winner')
        .setDescription('Winning team')
        .setRequired(true)
        .addChoices(
          { name: 'Team 1', value: 'team1' },
          { name: 'Team 2', value: 'team2' }
        )
    )
    .addStringOption(option =>
      option.setName('mvp')
        .setDescription('Top killer of the match')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('winbedbreaker')
        .setDescription('Bedbreaker from the winning team')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('losebedbreaker')
        .setDescription('Bedbreaker from the losing team (optional)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    if (interaction.channelId !== STAFF_CHANNEL_ID) {
      return interaction.reply({
        content: `❌ You can only use this command in <#${STAFF_CHANNEL_ID}>.`,
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    await logStaffCommand(interaction);

    const gameId = interaction.options.getString('gameid').toUpperCase();
    const winningTeam = interaction.options.getString('winner');
    const topKillerUsernameRaw = interaction.options.getString('mvp');
    const topKillerUsernames = topKillerUsernameRaw ? topKillerUsernameRaw.split(',').map(s => s.trim().toLowerCase()) : [];
    const winBedbreakerUsername = interaction.options.getString('winbedbreaker')?.toLowerCase();
    const loseBedbreakerUsername = interaction.options.getString('losebedbreaker')?.toLowerCase();

    if (activeConfirmLocks.has(gameId)) {
      return interaction.editReply({ content: `⚠️ Match #${gameId} is already being confirmed.` });
    }

    activeConfirmLocks.add(gameId);

    try {
      const activeGames = await getActiveGames();
      const match = activeGames.find(g => g.gameId === gameId);
      if (!match) {
        return interaction.editReply({ content: `❌ No active game found with ID #${gameId}` });
      }

      const isAllRank = isAllRankQueue(match.voiceChannelId);
      const guild = interaction.guild;
      const textChannel = await guild.channels.fetch(match.textChannelId).catch(() => null);
      const scoringChannel = await guild.channels.fetch(SCORING_CHANNEL_ID).catch(() => null);
      const logs = await getLogs();

      const team1 = match.teamA || match.teams?.[0] || [];
      const team2 = match.teamB || match.teams?.[1] || [];
      const winners = winningTeam === 'team1' ? team1 : team2;
      const losers = winningTeam === 'team1' ? team2 : team1;
      const allPlayerIds = [...winners, ...losers];

      let topKillerDisplayNames = topKillerUsernameRaw ? topKillerUsernameRaw.split(',').map(s => s.trim()) : [];
      let winBedbreakerDisplayName = winBedbreakerUsername;
      let loseBedbreakerDisplayName = loseBedbreakerUsername || null;

      const results = [];

      for (const playerId of allPlayerIds) {
        const member = await guild.members.fetch(playerId).catch(() => null);
        if (!member) continue;

        const player = await Player.load(member);
        const oldElo = player.elo;

        const isWinner = winners.includes(playerId);
        const isTopKiller = topKillerUsernames.includes(player.username.toLowerCase());
        const isWinBreaker = player.username.toLowerCase() === winBedbreakerUsername;
        const isLoseBreaker = loseBedbreakerUsername && player.username.toLowerCase() === loseBedbreakerUsername;

        if (isTopKiller) {
          const tkIndex = topKillerUsernames.indexOf(player.username.toLowerCase());
          if (tkIndex !== -1) topKillerDisplayNames[tkIndex] = member.displayName;
        }
        if (isWinBreaker) winBedbreakerDisplayName = member.displayName;
        if (isLoseBreaker) loseBedbreakerDisplayName = member.displayName;

        if (isWinner) {
          await player.win(gameId, isTopKiller, isWinBreaker);
        } else {
          await player.lose(gameId, isAllRank ? false : isTopKiller);
        }

        if (isTopKiller) await player.addTopKill();
        if (isWinBreaker || isLoseBreaker) await player.addBedBroken();

        await player.addRecentGame(gameId);
        await player.save();

        results.push({
          name: player.username,
          nickname: member.displayName,
          result: isWinner ? '🏆 Win' : '❌ Loss',
          oldElo,
          newElo: player.elo
        });
      }

      const finalTopKillerDisplayName = topKillerDisplayNames.join(', ');

      if (textChannel) {
        await textChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`🏆 Match #${gameId} Result`)
              .setDescription([
                `**${winningTeam === 'team1' ? 'Team 1' : 'Team 2'}** has won the match!`,
                `⭐ **Top Killer:** ${finalTopKillerDisplayName}`,
                `🔨 **Winning Bedbreaker:** ${winBedbreakerDisplayName}`,
                loseBedbreakerDisplayName ? `🔨 **Losing Bedbreaker:** ${loseBedbreakerDisplayName}` : null
              ].filter(Boolean).join('\n'))
              .setColor(0xffd700)
          ]
        }).catch(() => {});
      }

      if (scoringChannel) {
        const winnerLines = results.filter(p => p.result.includes('Win')).map(p => {
          const eloChange = p.newElo - p.oldElo;
          return `🏆 **${p.nickname}** — ELO: \`${p.oldElo}\` ➝ \`${p.newElo}\` (+${eloChange})`;
        }).join('\n');

        const loserLines = results.filter(p => p.result.includes('Loss')).map(p => {
          const eloChange = p.newElo - p.oldElo;
          return `❌ **${p.nickname}** — ELO: \`${p.oldElo}\` ➝ \`${p.newElo}\` (-${Math.abs(eloChange)})`;
        }).join('\n');

        const description = [
          `⭐ **MVP:** **${finalTopKillerDisplayName}**`,
          `🔨 **Winning Bedbreaker:** **${winBedbreakerDisplayName}**`,
          loseBedbreakerDisplayName ? `🔨 **Losing Bedbreaker:** **${loseBedbreakerDisplayName}**` : null,
          `🏅 **Winner:** **${winningTeam.toUpperCase()}**`,
          ``,
          `__**Winning Team:**__\n${winnerLines}`,
          ``,
          `__**Losing Team:**__\n${loserLines}`
        ].filter(Boolean).join('\n');

        await scoringChannel.send({
          content: allPlayerIds.map(id => `<@${id}>`).join(' '),
          embeds: [
            new EmbedBuilder()
              .setTitle(`📊 Game #${gameId} — ELO Summary`)
              .setDescription(description)
              .setColor(0x3498db)
              .setTimestamp()
          ]
        }).catch(() => {});
      }

      const category = await guild.channels.fetch(match.categoryId).catch(() => null);
      if (category) {
        const allChannels = await guild.channels.fetch();
        const children = allChannels.filter(c => c.parentId === category.id);
        for (const [, channel] of children) {
          await channel.delete().catch(() => {});
        }
        await category.delete().catch(() => {});
      }

      deleteActiveGame(gameId);
      updateMatchStatus(gameId, 'confirmed', winningTeam);

      const logEntry = logs[gameId];
      if (logEntry?.messageId) {
        const msg = await interaction.guild.channels.fetch(STAFF_CHANNEL_ID)
          .then(ch => ch.messages.fetch(logEntry.messageId))
          .catch(() => null);

        if (msg?.content) {
          const confirmedBy = `<@${interaction.user.id}>`;
          const updated = msg.content.replace(/📝 \*\*Status:\*\* .*/i, `📝 **Status:** Confirmed\nConfirmed by ${confirmedBy}`);
          await msg.edit({ content: updated }).catch(() => {});
        }
      }

      const confirmedBy = `<@${interaction.user.id}>`;

      const logUpdateOptions = {
        mvp: finalTopKillerDisplayName,
        topKiller: finalTopKillerDisplayName,
        bedbreaker: winBedbreakerDisplayName,
        confirmedBy
      };
      if (loseBedbreakerDisplayName) logUpdateOptions.loseBedbreaker = loseBedbreakerDisplayName;

      await editLogEmbed(interaction.client, guild.id, gameId, STAFF_CHANNEL_ID, 'confirmed', logUpdateOptions);
      await editLogEmbed(interaction.client, guild.id, gameId, MATCH_LOGS_ID, 'confirmed', logUpdateOptions);
      await editLogEmbed(interaction.client, guild.id, gameId, VERIFY_MATCH_CHANNEL_ID, 'confirmed', logUpdateOptions);

      await interaction.editReply({ content: `✅ Match #${gameId} has been scored and closed.` });
    } catch (err) {
      console.error(`[Confirm] Error confirming #${gameId}:`, err);
      await interaction.editReply({ content: `❌ An error occurred while confirming match #${gameId}.` });
    } finally {
      activeConfirmLocks.delete(gameId);
    }
  },

  autocomplete: async (interaction) => {
    const focused = interaction.options.getFocused(true);
    const activeGames = await getActiveGames();

    if (focused.name === 'gameid') {
      return interaction.respond(
        activeGames.map(g => g.gameId)
          .filter(id => id.toLowerCase().includes(focused.value.toLowerCase()))
          .slice(0, 25)
          .map(id => ({ name: `#${id}`, value: id }))
      );
    }

    const gameId = interaction.options.getString('gameid')?.toUpperCase();
    const match = activeGames.find(g => g.gameId === gameId);
    if (!match) return interaction.respond([]);

    const team1 = match.teamA || match.teams?.[0] || [];
    const team2 = match.teamB || match.teams?.[1] || [];
    const allPlayers = [...team1, ...team2];
    const members = await Promise.all(
      allPlayers.map(pid => interaction.guild.members.fetch(pid).catch(() => null))
    );

    const choices = await Promise.all(members.filter(Boolean).map(async member => {
      const player = await Player.load(member);
      return {
        name: member.displayName,
        value: player.username
      };
    }));

    // Support multiple selections separated by commas
    const inputParts = focused.value.split(',');
    const currentQuery = inputParts.pop().trim().toLowerCase();
    const previousSelection = inputParts.join(', ').trim();
    const prefix = previousSelection ? `${previousSelection}, ` : '';

    const filteredChoices = choices
      .filter(c => c.name.toLowerCase().includes(currentQuery) || c.value.toLowerCase().includes(currentQuery))
      .slice(0, 25);

    return interaction.respond(
      filteredChoices.map(c => ({
        name: `${prefix}${c.name}`,
        value: `${prefix}${c.value}`
      }))
    );
  }
};
