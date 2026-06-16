const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} = require('discord.js');
const { getRandomMaps } = require('../../utils/mapPicker');
require('dotenv').config();

// Mapping for teams to voice channel IDs
const TEAM_VOICE_IDS = {
  team1: process.env.TEAM_1_VOICE_ID,
  team2: process.env.TEAM_2_VOICE_ID,
  team3: process.env.TEAM_3_VOICE_ID,
  team4: process.env.TEAM_4_VOICE_ID,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('allstars')
    .setDescription('Allstars management commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('arenapick')
        .setDescription('Pick a map for an allstars match')
        .addStringOption(option =>
          option.setName('team1')
            .setDescription('First team')
            .setRequired(true)
            .addChoices(
              { name: 'Team 1', value: 'team1' },
              { name: 'Team 2', value: 'team2' },
              { name: 'Team 3', value: 'team3' },
              { name: 'Team 4', value: 'team4' }
            )
        )
        .addStringOption(option =>
          option.setName('team2')
            .setDescription('Second team')
            .setRequired(true)
            .addChoices(
              { name: 'Team 1', value: 'team1' },
              { name: 'Team 2', value: 'team2' },
              { name: 'Team 3', value: 'team3' },
              { name: 'Team 4', value: 'team4' }
            )
        )
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== 'arenapick') return;

    const team1Key = interaction.options.getString('team1');
    const team2Key = interaction.options.getString('team2');

    if (team1Key === team2Key) {
      return interaction.reply({ content: '❌ You must select two different teams.', ephemeral: true });
    }

    await interaction.deferReply();

    const guild = interaction.guild;
    const team1Channel = await guild.channels.fetch(TEAM_VOICE_IDS[team1Key]).catch(() => null);
    const team2Channel = await guild.channels.fetch(TEAM_VOICE_IDS[team2Key]).catch(() => null);

    const allowedUserIds = new Set();
    if (team1Channel) team1Channel.members.forEach(m => allowedUserIds.add(m.id));
    if (team2Channel) team2Channel.members.forEach(m => allowedUserIds.add(m.id));

    if (allowedUserIds.size === 0) {
      return interaction.editReply({ content: '❌ No players found in the selected team voice channels.', ephemeral: true });
    }

    const maps = getRandomMaps(3);
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('map_vote')
        .setPlaceholder('Vote for a map')
        .addOptions(maps.map(map => ({ label: map, value: map })))
    );

    const votes = new Map(); // Map<mapName, Set<userId>>
    maps.forEach(map => votes.set(map, new Set()));

    const getEmbedDescription = () => {
      let desc = `Teams: **${team1Key.toUpperCase()}** vs **${team2Key.toUpperCase()}**\n\n**Choices:**\n`;
      for (const [map, users] of votes) {
        desc += `- **${map}** (${users.size} votes): ${users.size > 0 ? Array.from(users).map(id => `<@${id}>`).join(', ') : 'No votes yet'}\n`;
      }
      desc += `\nOnly players in these team voices can vote. Voting ends in 30 seconds.`;
      return desc;
    };

    const embed = new EmbedBuilder()
      .setTitle('🗳️ Allstars Map Voting')
      .setDescription(getEmbedDescription())
      .setColor(0x3498db);

    const message = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 30000,
    });

    collector.on('collect', async i => {
      if (!allowedUserIds.has(i.user.id)) {
        return i.reply({ content: '❌ You are not allowed to vote in this match.', ephemeral: true });
      }

      const map = i.values[0];
      
      // Remove previous vote
      for (const [m, users] of votes) {
        users.delete(i.user.id);
      }

      votes.get(map).add(i.user.id);

      await i.update({ embeds: [embed.setDescription(getEmbedDescription())] });
    });

    collector.on('end', async () => {
      let winner = 'None';
      let maxVotes = 0;

      for (const [map, users] of votes) {
        if (users.size > maxVotes) {
          maxVotes = users.size;
          winner = map;
        }
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('🗳️ Voting Closed')
        .setDescription(`Result: **${winner}** (${maxVotes} votes)\n\n**Final Breakdown:**\n${getEmbedDescription().split('\n\n')[1]}`)
        .setColor(maxVotes > 0 ? 0x2ecc71 : 0xe74c3c);

      await interaction.editReply({ embeds: [resultEmbed], components: [] });
    });
  },
};
