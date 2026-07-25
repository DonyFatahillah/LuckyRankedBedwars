const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getActiveGames } = require('../../queue/queueManager');
const PlayerModel = require('../../models/PlayerSchema');

async function buildQueueStatsEmbed(channelId, userId) {
  const activeGames = await getActiveGames();
  
  let match = activeGames.find(g => 
    g.textChannelId === channelId || 
    g.channelId === channelId
  );

  if (!match) {
    match = activeGames.find(g => g.players.includes(userId));
  }

  if (!match) {
    return { error: "❌ You are not in an active match or this is not a match channel." };
  }

  const playerIds = match.players;
  const playersData = await PlayerModel.find({ userId: { $in: playerIds } }).lean();
  const statsMap = new Map(playersData.map(p => [p.userId, p]));

  const formatPlayer = (id) => {
    const data = statsMap.get(id);
    const username = data ? (data.ingameUsername || data.discordUsername || `<@${id}>`) : `<@${id}>`;
    const elo = data ? (data.elo || 0) : 0;
    const wins = data ? (data.wins || 0) : 0;
    const losses = data ? (data.losses || 0) : 0;
    const beds = data ? (data.bedsBroken || 0) : 0;
    const mvps = data ? (data.mvps || 0) : 0;
    return `\`${username}\`: **${elo}** ELO (W: ${wins} / L: ${losses} / B: ${beds} / MVP: ${mvps})`;
  };

  const embed = new EmbedBuilder()
    .setTitle(`📊 Match Stats - #${match.gameId}`)
    .setColor(0x00AAFF)
    .setTimestamp();

  const allPlayersStr = match.players.map(id => formatPlayer(id)).join('\n');
  embed.addFields({ name: "👥 Players", value: allPlayersStr, inline: false });

  return { embed };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queuestats')
    .setDescription("Show everyone's ELO, Win and Lose stats in the current match"),
  
  buildQueueStatsEmbed,

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const result = await buildQueueStatsEmbed(interaction.channel.id, interaction.user.id);
      if (result.error) {
        return interaction.editReply(result.error);
      }
      await interaction.editReply({ embeds: [result.embed] });
    } catch (error) {
      console.error('[QueueStats] Error:', error);
      await interaction.editReply("❌ An error occurred while fetching queue stats.");
    }
  }
};
