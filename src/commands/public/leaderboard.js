const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const { getRankByElo } = require('../../utils/EloRank');
const PlayerModel = require('../../models/PlayerSchema');

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show paginated leaderboard by ELO')
    .addStringOption(option => 
      option.setName('season')
        .setDescription('Optional season name to view archived data (e.g., S1)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const season = interaction.options.getString('season');

    try {
      let currentPage = 0;
      let players = [];
      let isArchived = false;

      if (season) {
        const archivePath = path.join(__dirname, '../../../archived', `archived-season-${season}.json`);
        if (fs.existsSync(archivePath)) {
          const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
          players = archiveData.players || [];
          isArchived = true;
          // Sort archived players by ELO just in case
          players.sort((a, b) => (b.elo || 0) - (a.elo || 0));
        } else {
          return interaction.editReply({ content: `❌ Archive for season \`${season}\` not found.` });
        }
      } else {
        // Fetch all players from DB, sorted by ELO descending
        players = await PlayerModel.find({}).sort({ elo: -1 }).lean();
      }

      console.log(`[Leaderboard Debug] Players found: ${players.length} (Archived: ${isArchived})`);

      const validEntries = players.map(p => ({
        userId: p.userId,
        elo: p.elo || 0,
        username: p.ingameUsername || p.discordUsername || `Unknown (${p.userId.slice(-4)})`,
        wins: p.wins || 0,
        losses: p.losses || 0
      }));

      const totalPages = Math.ceil(validEntries.length / PAGE_SIZE) || 1;

      // Step 2: Page renderer (uses validEntries)
      function renderPage(page) {
        const pageEntries = validEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        const lines = pageEntries.map((entry, index) => {
          const rankData = getRankByElo(entry.elo);
          const rank = rankData ? rankData.name : 'Unknown';
          return `**${page * PAGE_SIZE + index + 1}.** \`${entry.username}\` — **${entry.elo}** ELO — **${rank}** (W: ${entry.wins} / L: ${entry.losses})`;
        });

        const embed = new EmbedBuilder()
          .setTitle(isArchived ? `🏆 ELO LEADERBOARD - SEASON ${season}` : '🏆 ELO LEADERBOARD')
          .setDescription(lines.join('\n') || '*No players found.*')
          .setColor(0xFFD700)
          .setFooter({ text: `Page ${page + 1} of ${totalPages}${isArchived ? ' (Archived Data)' : ''}` })
          .setTimestamp(new Date());

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('⬅️ Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('➡️ Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        );

        return { embed, row };
      }

      // Step 3: Send first page
      let { embed, row } = renderPage(currentPage);
      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000, // 1 minute idle timeout
      });

      collector.on('collect', async (btn) => {
        await btn.deferUpdate();

        // Reset idle timeout on every interaction
        collector.resetTimer();

        if (btn.customId === 'prev' && currentPage > 0) currentPage--;
        if (btn.customId === 'next' && currentPage < totalPages - 1) currentPage++;

        const { embed: newEmbed, row: newRow } = renderPage(currentPage);
        await message.edit({ embeds: [newEmbed], components: [newRow] }).catch(() => {});
      });

      collector.on('end', async () => {
        const { embed: expiredEmbed } = renderPage(currentPage);
        expiredEmbed.setFooter({ text: `Page ${currentPage + 1} of ${totalPages} • Interaction expired` });

        // Disable buttons after idle timeout
        const disabledRow = new ActionRowBuilder().addComponents(
          row.components.map(btn => btn.setDisabled(true))
        );

        await message.edit({
          embeds: [expiredEmbed],
          components: [disabledRow],
        }).catch(() => {});
      });
    } catch (error) {
      console.error('[Leaderboard] Error fetching players:', error);
      await interaction.editReply({ content: '❌ Failed to fetch leaderboard data. Please try again later.', ephemeral: true });
    }
  }
};
