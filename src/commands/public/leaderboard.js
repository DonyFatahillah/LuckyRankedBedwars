const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
} = require('discord.js');

const { getRankByElo } = require('../../utils/EloRank');
const eloCache = require('../../cache/eloCache');
const Player = require('../../models/Player');

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show paginated leaderboard by ELO'),

  async execute(interaction) {
    await interaction.deferReply();

    let currentPage = 0;
    const sorted = eloCache.getSortedEntries();
    const validEntries = [];

    // Step 1: Build validEntries using pre-fetched names or discord.js collection
    // Fetch all members once to avoid hitting rate limits in a loop
    const allMembers = await interaction.guild.members.fetch();

    for (const [userId, elo] of sorted) {
      const member = allMembers.get(userId);
      if (!member) continue;

      const player = new Player(member);
      const username = player.ingameUsername || player.discordUsername;
      validEntries.push({ userId, elo, username });
    }

    const totalPages = Math.ceil(validEntries.length / PAGE_SIZE);

    // Step 2: Page renderer (uses cached validEntries)
    function renderPage(page) {
      const pageEntries = validEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

      const lines = pageEntries.map((entry, index) => {
        const rank = getRankByElo(entry.elo).name;
        return `${page * PAGE_SIZE + index + 1}. ${entry.username} — ${entry.elo} ELO — ${rank}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 ELO LEADERBOARD')
        .setDescription(lines.join('\n') || '*No players found.*')
        .setColor(0xFFD700)
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
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
  }
};
