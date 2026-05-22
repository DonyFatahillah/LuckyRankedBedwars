const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');
const PlayerModel = require('../../models/PlayerSchema');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setign')
    .setDescription('Set your in-game username or a player\'s in-game username')
    .addStringOption(option =>
      option.setName('ign')
        .setDescription('The in-game username to set')
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to set the IGN for (Admin only)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const newIgn = interaction.options.getString('ign').trim();
    const targetUser = interaction.options.getUser('target');
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    // 1. Permission check for target option
    if (targetUser && !isAdmin) {
      return interaction.reply({ 
        content: "❌ Only administrators can set the IGN for other users.", 
        ephemeral: true 
      });
    }

    const userToUpdate = targetUser || interaction.user;
    const isSelf = userToUpdate.id === interaction.user.id;

    // 2. Check if IGN is already taken (ignoring case)
    const existingPlayer = await PlayerModel.findOne({ 
      ingameUsername: { $regex: new RegExp(`^${newIgn}$`, 'i') } 
    });

    if (existingPlayer && existingPlayer.userId !== userToUpdate.id) {
      return interaction.reply({ 
        content: `❌ The in-game username **${newIgn}** is already being used by <@${existingPlayer.userId}>.`, 
        ephemeral: true 
      });
    }

    // 3. Load player and update
    try {
      const member = await interaction.guild.members.fetch(userToUpdate.id);
      const player = await Player.load(member);
      
      const oldIgn = player.ingameUsername;
      await player.setIngameUsername(newIgn);

      const successMessage = isSelf 
        ? `✅ Your in-game username has been updated from **${oldIgn || 'None'}** to **${newIgn}**.`
        : `✅ In-game username for ${userToUpdate} has been updated from **${oldIgn || 'None'}** to **${newIgn}**.`;

      return interaction.reply({ content: successMessage });
    } catch (err) {
      console.error(`[SetIGN] Error updating IGN for ${userToUpdate.id}:`, err);
      return interaction.reply({ 
        content: "❌ An error occurred while updating the in-game username. Please make sure the user is in the server.", 
        ephemeral: true 
      });
    }
  }
};
