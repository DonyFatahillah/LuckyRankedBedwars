const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranks')
    .setDescription('Show rank info with ELO, MVP, BED rewards and penalties'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('📊 Rating Info')
      .setColor(0xff0055)
      .setFooter({ text: 'Lucky Ranked Bedwars' });

    embed.setDescription(`
<@&${process.env.IRON_ROLE_ID}>: 0 Elo  \`+35\`  \`-10\`  **MVP** 15  **BED**: 5  
<@&${process.env.BRONZE_ROLE_ID}>: 100 Elo  \`+30\`  \`-10\`  **MVP** 15  **BED**: 5  
<@&${process.env.SILVER_ROLE_ID}>: 200 Elo  \`+30\`  \`-15\`  **MVP** 15  **BED**: 5  
<@&${process.env.GOLD_ROLE_ID}>: 300 Elo  \`+25\`  \`-15\`  **MVP** 10  **BED**: 5  
<@&${process.env.PLATINUM_ROLE_ID}>: 400 Elo  \`+25\`  \`-20\`  **MVP** 10  **BED**: 5  
<@&${process.env.DIAMOND_ROLE_ID}>: 500 Elo  \`+20\`  \`-20\`  **MVP** 5  **BED**: 5  
<@&${process.env.EMERALD_ROLE_ID}>: 600 Elo  \`+20\`  \`-25\`  **MVP** 5  **BED**: 5  
<@&${process.env.CRYSTAL_ROLE_ID}>: 700 Elo  \`+15\`  \`-25\`  **MVP** 5  **BED**: 5  
<@&${process.env.QUARTZ_ROLE_ID}>: 800 Elo  \`+15\`  \`-30\`  **MVP** 5  **BED**: 5  
<@&${process.env.SAPPHIRE_ROLE_ID}>: 900 Elo  \`+10\`  \`-30\`  **MVP** 5  **BED**: 5  
<@&${process.env.AMETHYST_ROLE_ID}>: 1000 Elo  \`+10\`  \`-35\`  **MVP** 5  **BED**: 5  
<@&${process.env.JADE_ROLE_ID}>: 1100 Elo  \`+10\`  \`-35\`  **MVP** 5  **BED**: 5  
<@&${process.env.OBSIDIAN_ROLE_ID}>: 1200 Elo  \`+10\`  \`-40\`  **MVP** 5  **BED**: 5  
<@&${process.env.ONYX_ROLE_ID}>: 1300 Elo  \`+10\`  \`-40\`  **MVP** 5  **BED**: 5  
<@&${process.env.AGATE_ROLE_ID}>: 1400 Elo  \`+10\`  \`-45\`  **MVP** 5  **BED**: 5  
<@&${process.env.ADAMITE_ROLE_ID}>: 1500 Elo  \`+5\`   \`-50\`  **MVP** 5  **BED**: 5  
<@&${process.env.PRISM_ROLE_ID}>: 1600 Elo  \`+5\`   \`-50\`  **MVP** 5  **BED**: 5  
<@&${process.env.AMBER_ROLE_ID}>: 1700 Elo  \`+5\`   \`-55\`  **MVP** 5  **BED**: 5  
<@&${process.env.AZURITE_ROLE_ID}>: 1800 Elo  \`+5\`   \`-60\`  **MVP** 5  **BED**: 5  
<@&${process.env.ELITE_ROLE_ID}>: 1900 Elo  \`+5\`   \`-65\`  **MVP** 5  **BED**: 5  
<@&${process.env.CELESTIAL_ROLE_ID}>: 2000 Elo  \`+5\`   \`-70\`  **MVP** 5  **BED**: 5
    `);

    await interaction.reply({ embeds: [embed], ephemeral: false });
  }
};
