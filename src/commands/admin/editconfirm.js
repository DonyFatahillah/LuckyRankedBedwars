const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');

const { getLogs, editLogEmbed } = require('../../utils/matchLogger');
const { logStaffCommand } = require('../../utils/staffLogger');
const Player = require('../../models/Player');
require('dotenv').config();

const SCORING_CHANNEL_ID = process.env.SCORING_CHANNEL_ID;
const STAFF_CHANNEL_ID = process.env.STAFF_VERIFY_CHANNEL_ID;
const MATCH_LOGS_ID = process.env.MATCH_LOGS_ID;
const VERIFY_MATCH_CHANNEL_ID = process.env.VERIFY_MATCH_CHANNEL_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editconfirm')
    .setDescription('Edit confirmation result (embed + logs + ELO summary)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('gameid')
        .setDescription('Match ID')
        .setRequired(true)
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
        .setDescription('MVP of the match')
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
        .setDescription('Bedbreaker from losing team (optional)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await logStaffCommand(interaction);

    const gameId = interaction.options.getString('gameid').toUpperCase();
    const winningTeam = interaction.options.getString('winner');
    const mvp = interaction.options.getString('mvp')?.split(',').map(s => s.trim()).join(', ');
    const winBedbreaker = interaction.options.getString('winbedbreaker');
    const loseBedbreaker = interaction.options.getString('losebedbreaker');

    const logs = await getLogs();
    const logEntry = logs[gameId];

    if (!logEntry) {
      return interaction.editReply({
        content: `❌ Match #${gameId} does not exist in match logs.`,
      });
    }

    const guild = interaction.guild;
    const scoringChannel = await guild.channels.fetch(SCORING_CHANNEL_ID).catch(() => null);
    const confirmedBy = `<@${interaction.user.id}>`;

    const winnerIds = winningTeam === 'team1' ? logEntry.team1 : logEntry.team2;
    const loserIds = winningTeam === 'team1' ? logEntry.team2 : logEntry.team1;

    const allPlayerIds = [...winnerIds, ...loserIds];
    const members = await Promise.all(
      allPlayerIds.map(id => guild.members.fetch(id).catch(() => null))
    );

    // Recalculate ELO for each player
    const results = [];
    const mvpNames = mvp ? mvp.toLowerCase().split(',').map(s => s.trim()) : [];
    const winBedbreakerName = winBedbreaker ? winBedbreaker.toLowerCase() : null;
    const loseBedbreakerName = loseBedbreaker ? loseBedbreaker.toLowerCase() : null;

    for (const member of members.filter(Boolean)) {
      try {
        const player = await Player.load(member);

        // Restore oldElo if exists in logs
        const oldElo = logEntry.players?.[member.id]?.oldElo ?? player.elo;
        player.elo = oldElo;

        const isWinner = winnerIds.includes(member.id);
        const isMvp = mvpNames.includes(player.username.toLowerCase());
        const isWinBreaker = winBedbreakerName === player.username.toLowerCase();
        const isLoseBreaker = loseBedbreakerName === player.username.toLowerCase();

        if (isWinner) await player.win(gameId, isMvp, isWinBreaker);
        else await player.lose(gameId, isMvp, isLoseBreaker);

        await player.save();

        results.push({
          nickname: member.displayName,
          oldElo,
          newElo: player.elo,
          isWinner
        });
      } catch (err) {
        console.error(`[editconfirm] Failed processing ${member.id}: ${err.message}`);
      }
    }

    // Send updated ELO summary to scoring channel
    if (scoringChannel) {
      const winnerLines = results.filter(p => p.isWinner).map(p => {
        const change = p.newElo - p.oldElo;
        return `🏆 **${p.nickname}** — ELO: \`${p.oldElo}\` ➝ \`${p.newElo}\` (${change >= 0 ? '+' : ''}${change})`;
      }).join('\n');

      const loserLines = results.filter(p => !p.isWinner).map(p => {
        const change = p.newElo - p.oldElo;
        return `❌ **${p.nickname}** — ELO: \`${p.oldElo}\` ➝ \`${p.newElo}\` (${change >= 0 ? '+' : ''}${change})`;
      }).join('\n');

      const description = [
        `⭐ **MVP:** ${mvp}`,
        `🔨 **Winning Bedbreaker:** ${winBedbreaker}`,
        loseBedbreaker ? `🔨 **Losing Bedbreaker:** ${loseBedbreaker}` : null,
        `🏅 **Winner:** ${winningTeam.toUpperCase()}`,
        ``,
        `__**Winning Team:**__\n${winnerLines}`,
        `__**Losing Team:**__\n${loserLines}`
      ].filter(Boolean).join('\n');

      await scoringChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📊 Game #${gameId} — ELO Summary (Edited)`)
            .setDescription(description)
            .setColor(0x3498db)
            .setTimestamp()
        ]
      }).catch(() => {});
    }

    // Update log embeds
    const updateData = {
      mvp,
      topKiller: mvp,
      bedbreaker: winBedbreaker,
      confirmedBy,
    };
    if (loseBedbreaker) updateData.loseBedbreaker = loseBedbreaker;

    for (const channelId of [STAFF_CHANNEL_ID, MATCH_LOGS_ID, VERIFY_MATCH_CHANNEL_ID]) {
      await editLogEmbed(interaction.client, guild.id, gameId, channelId, 'confirmed', updateData);
    }

    return interaction.editReply({
      content: `✅ Match #${gameId} confirmation updated with correct ELO summary.`,
    });
  },

  autocomplete: async (interaction) => {
    const focused = interaction.options.getFocused(true);
    const logs = await getLogs();

    if (focused.name === 'gameid') {
      return interaction.respond(
        Object.keys(logs)
          .filter(id => id.toLowerCase().includes(focused.value.toLowerCase()))
          .slice(0, 25)
          .map(id => ({ name: `#${id}`, value: id }))
      );
    }

    const gameId = interaction.options.getString('gameid')?.toUpperCase();
    const log = logs[gameId];
    if (!log) return interaction.respond([]);

    const ids = [...(log.team1 || []), ...(log.team2 || [])];
    const members = await Promise.all(
      ids.map(id => interaction.guild.members.fetch(id).catch(() => null))
    );

    const suggestions = members
      .filter(Boolean)
      .map(m => ({ name: m.displayName, value: m.user.username }))
      .filter(opt => opt.name.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25);

    return interaction.respond(suggestions);
  }
};
