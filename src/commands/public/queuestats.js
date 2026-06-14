const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getActiveGames } = require('../../queue/queueManager');
const PlayerModel = require('../../models/PlayerSchema');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queuestats')
    .setDescription("Show everyone's ELO, Win and Lose stats in the current match"),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const activeGames = await getActiveGames();
      
      // 1. Find the match by channel ID or user participation
      let match = activeGames.find(g => 
        g.textChannelId === interaction.channel.id || 
        g.channelId === interaction.channel.id
      );

      if (!match) {
        match = activeGames.find(g => g.players.includes(interaction.user.id));
      }

      if (!match) {
        return interaction.editReply("❌ You are not in an active match or this is not a match channel.");
      }

      // 2. Fetch player stats for all players in the match
      const playerIds = match.players;
      const playersData = await PlayerModel.find({ userId: { $in: playerIds } }).lean();
      const statsMap = new Map(playersData.map(p => [p.userId, p]));

      // Helper to format player stat line
      const formatPlayer = (id) => {
        const data = statsMap.get(id);
        const username = data ? (data.ingameUsername || data.discordUsername || `<@${id}>`) : `<@${id}>`;
        const elo = data ? (data.elo || 0) : 0;
        const wins = data ? (data.wins || 0) : 0;
        const losses = data ? (data.losses || 0) : 0;
        return `\`${username}\`: **${elo}** ELO (W: ${wins} / L: ${losses})`;
      };

      const embed = new EmbedBuilder()
        .setTitle(`📊 Match Stats - #${match.gameId}`)
        .setDescription(`**Queue Type:** ${match.queueType || 'N/A'}\n**Map:** ${match.map || 'TBD'}`)
        .setColor(0x00AAFF)
        .setTimestamp();

      // 3. Group by teams if available
      const hasTeams = (match.teamA && match.teamA.length > 0) || (match.teamB && match.teamB.length > 0);
      
      if (hasTeams) {
        const teamAStr = match.teamA.map(id => formatPlayer(id)).join('\n') || "None";
        const teamBStr = match.teamB.map(id => formatPlayer(id)).join('\n') || "None";
        
        embed.addFields(
          { name: "🔵 Team A", value: teamAStr, inline: false },
          { name: "🔴 Team B", value: teamBStr, inline: false }
        );

        if (match.unpickedPlayers && match.unpickedPlayers.length > 0) {
          const poolStr = match.unpickedPlayers.map(id => formatPlayer(id)).join('\n');
          embed.addFields({ name: "🏐 Unpicked Pool", value: poolStr, inline: false });
        }
      } else {
        const allPlayersStr = match.players.map(id => formatPlayer(id)).join('\n');
        embed.addFields({ name: "👥 Players", value: allPlayersStr, inline: false });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('[QueueStats] Error:', error);
      await interaction.editReply("❌ An error occurred while fetching queue stats.");
    }
  }
};
