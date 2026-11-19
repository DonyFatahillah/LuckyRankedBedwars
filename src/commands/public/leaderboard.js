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

const { generateLeaderboardImage } = require('../../utils/leaderboardImage');
const PlayerModel = require('../../models/PlayerSchema');

const PAGE_SIZE = 10;
const LEADERBOARD_MODES = {
  normal: { label: 'NORMAL (3v3 / 4v4)', elo: 'elo', wins: 'wins', losses: 'losses', kills: 'kills', deaths: 'deaths' },
  doubles: { label: 'DOUBLES (2v2)', elo: 'double_elo', wins: 'double_wins', losses: 'double_losses', kills: 'double_kills', deaths: 'double_deaths' }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the normal or doubles ELO leaderboard')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Choose normal (shared 3v3 / 4v4 stats) or doubles; defaults to normal')
        .setRequired(false)
        .addChoices(
          { name: 'Normal (3v3 / 4v4)', value: 'normal' },
          { name: 'Doubles (2v2)', value: 'doubles' }
        )
    )
    .addStringOption(option => 
      option.setName('season')
        .setDescription('Optional season name to view archived data (e.g., S1)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const season = interaction.options.getString('season');
    const mode = interaction.options.getString('mode') || 'normal';
    const stats = LEADERBOARD_MODES[mode];

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
          if (mode === 'doubles' && !players.some(p => p.double_elo != null)) {
            return interaction.editReply({ content: `❌ No doubles leaderboard data is available for season \`${season}\`.` });
          }
          // Sort archives by the selected mode's ELO.
          players.sort((a, b) => (b[stats.elo] || 0) - (a[stats.elo] || 0));
        } else {
          return interaction.editReply({ content: `❌ Archive for season \`${season}\` not found.` });
        }
      } else {
        // Normal combines 3v3 / 4v4; doubles uses its own independent stats.
        players = await PlayerModel.find({}).sort({ [stats.elo]: -1 }).lean();
      }

      console.log(`[Leaderboard Debug] Players found: ${players.length} (Mode: ${mode}, Archived: ${isArchived})`);

      const validEntries = players.map(p => ({
        userId: p.userId,
        minecraftUuid: p.minecraftUuid,
        elo: p[stats.elo] || 0,
        username: p.ingameUsername || p.discordUsername || `Unknown (${p.userId.slice(-4)})`,
        wins: p[stats.wins] || 0,
        losses: p[stats.losses] || 0,
        // Old archives did not record combat totals; do not imply they were zero.
        kills: p[stats.kills] ?? (isArchived ? null : 0),
        deaths: p[stats.deaths] ?? (isArchived ? null : 0)
      }));

      const totalPages = Math.ceil(validEntries.length / PAGE_SIZE) || 1;

      const title = `${stats.label} ELO LEADERBOARD${isArchived ? ` - SEASON ${season}` : ''}`;
      const pageImages = new Map();

      function buildRow(page, disabled = false) {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('⬅️ Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page === 0),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('➡️ Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page >= totalPages - 1)
        );
      }

      async function renderPage(page) {
        // Cache rendered pages for this message, including their fetched heads.
        if (!pageImages.has(page)) {
          pageImages.set(page, generateLeaderboardImage(
            validEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
            { startPosition: page * PAGE_SIZE + 1, title }
          ).catch(error => {
            pageImages.delete(page);
            throw error;
          }));
        }
        const image = await pageImages.get(page);
        const embed = new EmbedBuilder()
          .setTitle(`🏆 ${title}`)
          .setImage('attachment://leaderboard.png')
          .setColor(0xFFD700)
          .setFooter({ text: `Page ${page + 1} of ${totalPages}${isArchived ? ' (Archived Data)' : ''}` })
          .setTimestamp(new Date());
        return { embed, image };
      }

      let { embed, image } = await renderPage(currentPage);
      const message = await interaction.editReply({
        embeds: [embed], files: [image], components: [buildRow(currentPage)]
      });

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        idle: 60000
      });

      // Serialize edits so rapid clicks or expiry cannot overwrite a newer page.
      let pendingEdit = Promise.resolve();
      collector.on('collect', (btn) => {
        const acknowledged = btn.deferUpdate();
        collector.resetTimer();
        pendingEdit = pendingEdit.then(async () => {
          await acknowledged;
          let nextPage = currentPage;
          if (btn.customId === 'prev' && nextPage > 0) nextPage--;
          if (btn.customId === 'next' && nextPage < totalPages - 1) nextPage++;
          if (nextPage === currentPage) return;

          const rendered = await renderPage(nextPage);
          await message.edit({
            embeds: [rendered.embed], attachments: [], files: [rendered.image],
            components: [buildRow(nextPage)]
          });
          currentPage = nextPage;
          embed = rendered.embed;
        }).catch(error => console.error('[Leaderboard] Failed to change page:', error));
        return pendingEdit;
      });

      collector.on('end', () => {
        pendingEdit = pendingEdit.then(async () => {
          embed.setFooter({ text: `Page ${currentPage + 1} of ${totalPages}${isArchived ? ' (Archived Data)' : ''} • Interaction expired` });
          // Keep the current image attachment; only update the footer/buttons.
          await message.edit({ embeds: [embed], components: [buildRow(currentPage, true)] });
        }).catch(error => console.error('[Leaderboard] Failed to expire controls:', error));
        return pendingEdit;
      });
    } catch (error) {
      console.error('[Leaderboard] Error fetching players:', error);
      await interaction.editReply({ content: '❌ Failed to fetch leaderboard data. Please try again later.', ephemeral: true });
    }
  }
};
