const { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder 
} = require('discord.js');

const { logStaffCommand } = require('../../utils/staffLogger');
const { updateMatchStatus, getMatchLog, editLogEmbed } = require('../../utils/matchLogger');
const { getActiveGames, deleteActiveGame } = require('../../queue/queueManager');
const ActiveGame = require('../../models/ActiveGame');
const Player = require('../../models/Player');
const { publishMatchVoid } = require('../../utils/redisClient');
require('dotenv').config();

const STAFF_CHANNEL_ID = process.env.STAFF_VERIFY_CHANNEL_ID;
const MATCH_LOGS_ID = process.env.MATCH_LOGS_ID;
const VERIFY_MATCH_CHANNEL_ID = process.env.VERIFY_MATCH_CHANNEL_ID;
const SCORING_CHANNEL_ID = process.env.SCORING_CHANNEL_ID;

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
    const activeGames = await getActiveGames();
    
    // getLogs() returns an object where keys are gameIds
    const { getLogs } = require('../../utils/matchLogger');
    const logs = await getLogs();

    const choices = [
      ...activeGames.map(g => g.gameId),
      ...Object.keys(logs)
    ]
      .filter(id => id.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25);

    await interaction.respond(choices.map(id => ({ name: id, value: id })));
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const gameId = interaction.options.getString('gameid').toUpperCase();
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';

    await logStaffCommand(interaction);

    const guild = interaction.guild;
    const match = await getMatchLog(gameId);
    if (!match) {
      return interaction.editReply({ content: `❌ Match ${gameId} not found.`, ephemeral: true });
    }

    const scoringChannel = await guild.channels.fetch(SCORING_CHANNEL_ID).catch(() => null);
    const activeMatch = await ActiveGame.load(gameId);
    let removedFromActive = false;

    // If match is active (not yet confirmed)
    if (activeMatch) {
      const category = await guild.channels.fetch(activeMatch.categoryId).catch(() => null);
      if (category) {
        const children = category.children.cache;
        for (const [, channel] of children) await channel.delete().catch(() => {});
        await category.delete().catch(() => {});
      }
      await deleteActiveGame(gameId);
      removedFromActive = true;
      
      await publishMatchVoid({ matchId: gameId, action: 'void' }).catch(() => {});
    } 
    
    // If match is already confirmed, revert ELO
    else if (match.status === 'confirmed') {
      const winners = match.winners || [];
      const losers = match.losers || [];
      const allPlayerIds = [...winners, ...losers];
      const results = [];

      for (const pid of allPlayerIds) {
        const member = await guild.members.fetch(pid).catch(() => null);
        if (!member) continue;
        
        const player = await Player.load(member);
        const oldElo = player.elo;
        const isWinner = winners.includes(pid);

        // Revert calculations
        if (isWinner) {
          const winGain = player.getWinGain();
          const mvpBonus = (match.mvp && member.displayName.toLowerCase() === match.mvp.toLowerCase()) ? player.getMvpBonus() : 0;
          const bedBonus = (match.bedbreaker && member.displayName.toLowerCase() === match.bedbreaker.toLowerCase()) ? 5 : 0;
          const totalGain = winGain + mvpBonus + bedBonus;
          await player.setElo(Math.max(0, oldElo - totalGain));
        } else {
          const lossPenalty = player.getLossPenalty();
          const mvpReduction = (match.mvp && member.displayName.toLowerCase() === match.mvp.toLowerCase()) ? player.getMvpBonus() : 0;
          const totalLoss = Math.max(0, lossPenalty - mvpReduction);
          await player.setElo(oldElo + totalLoss);
        }

        results.push({ nickname: member.displayName, oldElo, newElo: player.elo });
      }

      if (scoringChannel) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Game #${gameId} — ELO Reverted`)
          .setDescription(`**Reason:** ${reason}\n\n__**Players:**__\n${results.map(r => `**${r.nickname}** — \`${r.oldElo}\` ➝ \`${r.newElo}\``).join('\n')}`)
          .setColor(0xe74c3c)
          .setTimestamp();
        await scoringChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }

    await updateMatchStatus(gameId, 'void');
    await editLogEmbed(interaction.client, guild.id, gameId, STAFF_CHANNEL_ID, 'void', { reason });
    await editLogEmbed(interaction.client, guild.id, gameId, MATCH_LOGS_ID, 'void', { reason });
    await editLogEmbed(interaction.client, guild.id, gameId, VERIFY_MATCH_CHANNEL_ID, 'void', { reason });

    try {
      await interaction.editReply({
        content: `✅ Match ${gameId} has been voided.${removedFromActive ? '' : ' (ELO reverted)'}`,
        ephemeral: true
      });
    } catch (err) {
      console.warn(`[void] Failed to send final reply: ${err.message}`);
    }
  }
};
