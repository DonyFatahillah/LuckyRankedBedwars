const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const Player = require('../../models/Player');

require('dotenv').config();
const STAFF_LOG_ID = process.env.SEASON_LOGS_CHANNEL_ID;

const dataDir = path.join(__dirname, '../../../data');
const matchLogPath = path.join(dataDir, 'matchLogs.json');
const eloPath = path.join(dataDir, 'elo.json');
const statsPath = path.join(dataDir, 'playerStats.json');
const seasonPath = path.join(dataDir, 'season.json');

function getNextSeasonNumber() {
  let currentSeason = 0;
  if (fs.existsSync(seasonPath)) {
    const json = JSON.parse(fs.readFileSync(seasonPath, 'utf-8'));
    currentSeason = json.season || 0;
  }
  const nextSeason = currentSeason + 1;
  fs.writeFileSync(seasonPath, JSON.stringify({ season: nextSeason }, null, 2));
  return nextSeason;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('endseason')
    .setDescription('📅 Ends the current ranked season and resets all ELO/stats.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const season = getNextSeasonNumber();

      const matchBackup = path.join(dataDir, `matchLogs-season-${season}.json`);
      const statsBackup = path.join(dataDir, `playerStats-season-${season}.json`);
      const eloBackup = path.join(dataDir, `elo-season-${season}.json`);

      if (fs.existsSync(matchLogPath)) fs.renameSync(matchLogPath, matchBackup);
      if (fs.existsSync(statsPath)) fs.renameSync(statsPath, statsBackup);
      if (fs.existsSync(eloPath)) fs.renameSync(eloPath, eloBackup);

      const oldLogs = JSON.parse(fs.readFileSync(matchBackup));
      const oldStats = JSON.parse(fs.readFileSync(statsBackup));
      const oldElo = JSON.parse(fs.readFileSync(eloBackup));

      // ✅ Reset ELOs
      const eloReset = {};
      for (const userId of Object.keys(oldElo)) {
        eloReset[userId] = 0;
      }
      fs.writeFileSync(eloPath, JSON.stringify(eloReset, null, 2));

      // ✅ Reset Stats
      const statsReset = {};
      for (const userId of Object.keys(oldStats)) {
        statsReset[userId] = {
          wins: 0,
          losses: 0,
          winstreak: 0,
          mvps: 0,
          bedsBroken: 0
        };
      }
      fs.writeFileSync(statsPath, JSON.stringify(statsReset, null, 2));

      // ✅ Reset matchLogs
      fs.writeFileSync(matchLogPath, JSON.stringify({}, null, 2));

      // 📊 Summary
      const confirmed = Object.values(oldLogs).filter(log => log.status === 'confirmed');
      const totalMatches = confirmed.length;

      const top10 = Object.entries(oldElo).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const mostWins = Object.entries(oldStats).sort((a, b) => (b[1]?.wins || 0) - (a[1]?.wins || 0))[0];
      const mostMVPs = Object.entries(oldStats).sort((a, b) => (b[1]?.mvps || 0) - (a[1]?.mvps || 0))[0];
      const mostBeds = Object.entries(oldStats).sort((a, b) => (b[1]?.bedsBroken || 0) - (a[1]?.bedsBroken || 0))[0];

      // 🧼 Embed 1: Reset confirmation
      const resetEmbed = new EmbedBuilder()
        .setTitle(`🏁 Season ${season} Ended`)
        .setDescription(`**Executed by:** <@${interaction.user.id}>\nAll ELO, stats, and matches have been reset.\nBackups saved as \`*-season-${season}.json\`.`)
        .setColor(0xff4757)
        .setTimestamp();

      // 📊 Embed 2: Summary
      const summaryEmbed = new EmbedBuilder()
        .setTitle(`📊 Season ${season} Summary`)
        .addFields(
          { name: '🕹️ Total Confirmed Matches', value: `${totalMatches}`, inline: true },
          { name: '🥇 Most Wins', value: `<@${mostWins[0]}> — \`${mostWins[1].wins}\` wins`, inline: true },
          { name: '🗡️ Most MVPs', value: `<@${mostMVPs[0]}> — \`${mostMVPs[1].mvps}\` MVPs`, inline: true },
          { name: '🛏️ Most Beds Broken', value: `<@${mostBeds[0]}> — \`${mostBeds[1].bedsBroken}\` beds`, inline: true },
          {
            name: '🏆 Top 10 ELOs',
            value: top10.map((u, i) => `\`${i + 1}.\` <@${u[0]}> — **${u[1]}**`).join('\n'),
            inline: false
          }
        )
        .setColor(0x3498db)
        .setTimestamp();

      // 📛 Rename all players to [0] name
      for (const userId of Object.keys(oldElo)) {
        try {
          const member = await interaction.guild.members.fetch(userId);
          const player = new Player(member);
          await player.setElo(0); // updates nickname + roles
        } catch (err) {
          console.warn(`[endseason] Failed to rename or update ${userId}:`, err.message);
        }
      }

      // 📤 Post to staff logs
      const staffChannel = interaction.client.channels.cache.get(STAFF_LOG_ID);
      if (staffChannel) {
        await staffChannel.send({ embeds: [resetEmbed, summaryEmbed] });
      }

      await interaction.editReply({
        content: `✅ Season ${season} ended. All data reset and archived.`,
        embeds: [resetEmbed, summaryEmbed]
      });

    } catch (err) {
      console.error('[endseason] ❌', err);
      await interaction.editReply({ content: '❌ Failed to end season. Check logs.' });
    }
  }
};
