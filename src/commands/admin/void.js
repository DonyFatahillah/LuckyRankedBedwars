const { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder 
} = require('discord.js');

const { logStaffCommand } = require('../../utils/staffLogger');
const { getActiveGames, deleteActiveGame } = require('../../queue/queueManager');
const Player = require('../../models/Player');
const { updateMatchStatus, getLogs, editLogEmbed } = require('../../utils/matchLogger');
const { publishMatch } = require('../../utils/redisClient');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const STAFF_CHANNEL_ID = process.env.STAFF_VERIFY_CHANNEL_ID;
const MATCH_LOGS_ID = process.env.MATCH_LOGS_ID;
const VERIFY_MATCH_CHANNEL_ID = process.env.VERIFY_MATCH_CHANNEL_ID;
const SCORING_CHANNEL_ID = process.env.SCORING_CHANNEL_ID;

const STATS_PATH = path.join(__dirname, '../../../data/playerStats.json');
function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')); } 
  catch { return {}; }
}
function saveStats(data) {
  fs.writeFileSync(STATS_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('void')
    .setDescription('Void a match. Deletes it from active games or reverts ELO if confirmed.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('gameid')
        .setDescription('The Game ID to void')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Optional reason for void')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const activeGames = getActiveGames();
    const logs = getLogs();

    const choices = [
      ...activeGames.keys(), 
      ...Object.keys(logs)
    ]
      .filter(id => id.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25);

    await interaction.respond(choices.map(id => ({ name: id, value: id })));
  },

  async execute(interaction) {
    const gameId = interaction.options.getString('gameid').toUpperCase();
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';
    const activeGames = getActiveGames();
    const logs = getLogs();
    let removedFromActive = false;

    await logStaffCommand(interaction);

    const match = logs[gameId];
    if (!match) {
      return interaction.reply({ content: `❌ Match ${gameId} not found.`, ephemeral: true });
    }

    const guild = interaction.guild;
    const scoringChannel = await guild.channels.fetch(SCORING_CHANNEL_ID).catch(() => null);

    const stats = loadStats();

    // If match is active (not yet confirmed)
    if (activeGames.has(gameId)) {
      const activeMatch = activeGames.get(gameId);
      const category = await guild.channels.fetch(activeMatch.categoryId).catch(() => null);
      if (category) {
        const allChannels = await guild.channels.fetch();
        const children = allChannels.filter(c => c.parentId === category.id);
        for (const [, channel] of children) await channel.delete().catch(() => {});
        await category.delete().catch(() => {});
      }
      deleteActiveGame(gameId);
      removedFromActive = true;
      
      // Notify Minecraft plugin
      await publishMatch({ matchId: gameId, action: 'void' }).catch(() => {});
    } 
    
    // ✅ If match is already confirmed, revert ELO properly
    else if (match.status === 'confirmed') {
      const winners = match.winner === 'team1' ? match.team1 : match.team2;
      const losers = match.winner === 'team1' ? match.team2 : match.team1;
      const allPlayerIds = [...winners, ...losers];
      const members = await Promise.all(allPlayerIds.map(pid => guild.members.fetch(pid).catch(() => null)));
      const results = [];

      for (const member of members.filter(Boolean)) {
        const player = new Player(member);
        const oldElo = player.elo;
        const isWinner = winners.includes(member.id);
        const isMVP = match.mvp && member.displayName.toLowerCase() === match.mvp.toLowerCase();
        const isBedbreaker = match.bedbreaker && member.displayName.toLowerCase() === match.bedbreaker.toLowerCase();

        let newElo = oldElo;
        if (isWinner) {
          // Revert win: subtract what they gained
          const winGain = player.getWinGain();
          const mvpBonus = isMVP ? player.getMvpBonus() : 0;
          const bedBonus = isBedbreaker ? 5 : 0;
          const totalGain = winGain + mvpBonus + bedBonus;
          newElo = Math.max(0, oldElo - totalGain);
        } else {
          // Revert loss: add back what they lost
          const lossPenalty = player.getLossPenalty();
          const mvpReduction = isMVP ? player.getMvpBonus() : 0;
          const totalLoss = Math.max(0, lossPenalty - mvpReduction);
          newElo = oldElo + totalLoss;
        }

        await player.setElo(newElo);
        results.push({
          nickname: member.displayName,
          oldElo,
          newElo,
        });
      }

      saveStats(stats);

      // 📊 Send ELO revert summary
      if (scoringChannel) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Game #${gameId} — ELO Reverted`)
          .setDescription([
            `**Reason:** ${reason}`,
            ``,
            `__**Players:**__`,
            results.map(r => 
              `**${r.nickname}** — ELO: \`${r.oldElo}\` ➝ \`${r.newElo}\` (${r.oldElo - r.newElo >= 0 ? '-' : '+'}${Math.abs(r.oldElo - r.newElo)})`
            ).join('\n')
          ].join('\n'))
          .setColor(0xe74c3c)
          .setTimestamp(new Date());

        await scoringChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }

    // ✅ Update match status in logs
    updateMatchStatus(gameId, 'void', { reason });

    // ✅ Update all log embeds
    await editLogEmbed(interaction.client, guild.id, gameId, STAFF_CHANNEL_ID, 'void', { reason });
    await editLogEmbed(interaction.client, guild.id, gameId, MATCH_LOGS_ID, 'void', { reason });
    await editLogEmbed(interaction.client, guild.id, gameId, VERIFY_MATCH_CHANNEL_ID, 'void', { reason });

    // ✅ Update original submit message
    if (match.messageId) {
      const msg = await guild.channels.fetch(STAFF_CHANNEL_ID)
        .then(ch => ch.messages.fetch(match.messageId))
        .catch(() => null);

      if (msg?.content) {
        const updated = msg.content.replace(/📝 \*\*Status:\*\* .*/i, `📝 **Status:** Void\nReason: ${reason}`);
        await msg.edit({ content: updated }).catch(() => {});
      }
    }

    // ✅ Reply to staff
    try {
      await interaction.reply({
        content: `✅ Match ${gameId} has been voided.${removedFromActive ? '' : ' (ELO reverted)'}`,
        ephemeral: true
      });
    } catch {}
  }
};
