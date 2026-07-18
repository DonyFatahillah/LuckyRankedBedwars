const { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder 
} = require('discord.js');

const { logStaffCommand } = require('../../utils/staffLogger');
const { updateMatchStatus, getMatchLog, editLogEmbed, logMatch } = require('../../utils/matchLogger');
const { deleteActiveGame } = require('../../queue/queueManager');
const ActiveGame = require('../../models/ActiveGame');
const Player = require('../../models/Player');
const { publishMatchVoid, redis } = require('../../utils/redisClient');
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
    )
    .addStringOption(option =>
      option.setName('team1')
        .setDescription('Custom team 1 (comma-separated usernames)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('team2')
        .setDescription('Custom team 2 (comma-separated usernames)')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    
    try {
      const [gameKeys, matchKeys] = await Promise.all([
        redis.keys('game:*'),
        redis.keys('match:*')
      ]);

      const gameIds = new Set([
        ...gameKeys.map(k => k.split(':')[1]),
        ...matchKeys.map(k => k.split(':')[1])
      ]);

      const filtered = Array.from(gameIds)
        .filter(id => id.toLowerCase().includes(focused))
        .slice(0, 25)
        .map(id => ({ name: id, value: id }));

      await interaction.respond(filtered);
    } catch (err) {
      console.error(`[Void Autocomplete] Response error:`, err);
    }
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const gameId = interaction.options.getString('gameid').toUpperCase();
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';
    const customTeam1 = interaction.options.getString('team1');
    const customTeam2 = interaction.options.getString('team2');

    await logStaffCommand(interaction);

    const guild = interaction.guild;
    const activeMatch = await ActiveGame.load(gameId);
    let match = await getMatchLog(gameId);

    if (!match && !activeMatch) {
      return interaction.editReply({ content: `❌ Match ${gameId} not found.`, ephemeral: true });
    }

    if (!match && activeMatch) {
      await logMatch(gameId, activeMatch.teamA, activeMatch.teamB, {
        queueType: activeMatch.queueType,
        mapName: activeMatch.map
      });
      match = await getMatchLog(gameId);
    }

    const scoringChannel = await guild.channels.fetch(SCORING_CHANNEL_ID).catch(() => null);
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
      let team1 = match.team1 || [];
      let team2 = match.team2 || [];

      const PlayerModel = require('../../models/PlayerSchema');

      if (customTeam1) {
        const t1Names = customTeam1.split(',').map(s => s.trim());
        const t1Docs = await PlayerModel.find({
          $or: [
            { ingameUsername: { $in: t1Names.map(n => new RegExp(`^${n}$`, 'i')) } },
            { discordUsername: { $in: t1Names.map(n => new RegExp(`^${n}$`, 'i')) } }
          ]
        });
        if (t1Docs.length > 0) team1 = t1Docs.map(d => d.userId);
      }

      if (customTeam2) {
        const t2Names = customTeam2.split(',').map(s => s.trim());
        const t2Docs = await PlayerModel.find({
          $or: [
            { ingameUsername: { $in: t2Names.map(n => new RegExp(`^${n}$`, 'i')) } },
            { discordUsername: { $in: t2Names.map(n => new RegExp(`^${n}$`, 'i')) } }
          ]
        });
        if (t2Docs.length > 0) team2 = t2Docs.map(d => d.userId);
      }

      const winners = (match.winner === 'team1' || !match.winner) ? team1 : team2;
      const losers = (match.winner === 'team1' || !match.winner) ? team2 : team1;

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

        results.push({
          name: player.username,
          nickname: member.displayName,
          result: isWinner ? '🏆 Win' : '❌ Loss',
          oldElo,
          newElo: player.elo
        });
      }

      if (scoringChannel) {
        const { generateScoreImage } = require('../../utils/scoreImage');
        
        let attachment = null;
        try {
          const mvpNames = match.mvp ? match.mvp.split(',').map(s => s.trim()) : [];
          const winBedbreaker = match.bedbreaker ? [match.bedbreaker] : [];
          const loseBedbreaker = match.loseBedbreaker ? [match.loseBedbreaker] : [];

          attachment = await generateScoreImage(
            gameId,
            match.winner || 'team1',
            results,
            mvpNames,
            winBedbreaker,
            loseBedbreaker,
            match.mapName || 'Unknown'
          );
        } catch (imgErr) {
          console.error(`[Void] Failed to generate score image for game ${gameId}:`, imgErr);
        }

        const embed = new EmbedBuilder()
          .setTitle(`📊 Game #${gameId} — ELO Reverted`)
          .setDescription(`**Reason:** ${reason}\n\n__**Players:**__\n${results.map(r => `**${r.nickname}** — \`${r.oldElo}\` ➝ \`${r.newElo}\``).join('\n')}`)
          .setColor(0xe74c3c)
          .setTimestamp();

        if (attachment) {
          await scoringChannel.send({
            content: allPlayerIds.map(id => `<@${id}>`).join(' '),
            files: [attachment]
          }).catch(() => {});
        } else {
          await scoringChannel.send({
            content: allPlayerIds.map(id => `<@${id}>`).join(' '),
            embeds: [embed]
          }).catch(() => {});
        }
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
