const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const ActiveGame = require('../../models/ActiveGame');
const { publishMatch } = require('../../utils/redisClient');
const Player = require('../../models/Player');
const { logMatch, sendLogToStaffChannel } = require('../../utils/matchLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pick')
    .setDescription('Pick a player for your team (High-tier matches only)')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The player you want to pick')
        .setRequired(true)
    ),

  async execute(interaction) {
    return interaction.reply({ 
      content: "❌ The `/pick` command is now deprecated. Please use the **Select Menu** provided in the match chat to pick your teammates.", 
      ephemeral: true 
    });
  }
};
