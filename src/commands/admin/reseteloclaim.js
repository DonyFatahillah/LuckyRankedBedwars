const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const CLAIMED_PATH = path.join(__dirname, '../../../data/claimedElo.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reseteloclaim')
    .setDescription('Reset all ELO claims for the season (clears claimedElo.json)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      // Ensure the directory exists
      const dir = path.dirname(CLAIMED_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Clear the json file by writing an empty object
      fs.writeFileSync(CLAIMED_PATH, JSON.stringify({}, null, 2));
      
      return interaction.reply({ 
        content: '✅ Successfully reset all ELO claims.', 
        ephemeral: true 
      });
    } catch (error) {
      console.error('[reseteloclaim] Error:', error);
      return interaction.reply({ 
        content: '❌ Failed to reset ELO claims.', 
        ephemeral: true 
      });
    }
  }
};
