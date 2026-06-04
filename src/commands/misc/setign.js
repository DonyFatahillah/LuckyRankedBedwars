const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');
const PlayerModel = require('../../models/PlayerSchema');
const { getActiveGames } = require('../../queue/queueManager');
const { redis } = require('../../utils/redisClient');

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

    // 2. Validate Minecraft Username format
    const mcUsernameRegex = /^[a-zA-Z0-9_]{3,16}$/;
    if (!mcUsernameRegex.test(newIgn)) {
      return interaction.reply({
        content: `❌ **${newIgn}** is not a valid Minecraft username. It must be 3-16 characters long and only contain letters, numbers, and underscores.`,
        ephemeral: true
      });
    }

    // 3. Prevent IGN change if user is in-game
    const activeGames = await getActiveGames();
    const isInGame = activeGames.some(game => game.players.includes(userToUpdate.id));
    if (isInGame) {
      return interaction.reply({
        content: `❌ ${isSelf ? 'You' : 'That user'} cannot change IGN while in an active match!`,
        ephemeral: true
      });
    }

    // 4. Redis Lock to prevent Race Condition
    const lockKey = `lock:ign:${newIgn.toLowerCase()}`;
    const acquired = await redis.set(lockKey, interaction.user.id, 'NX', 'EX', 10);
    if (!acquired) {
      return interaction.reply({
        content: `❌ The username **${newIgn}** is currently being updated by someone else. Please wait a moment.`,
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(userToUpdate.id);
      const player = await Player.load(member);

      // 5. Cooldown check (24 hours = 86400000 ms)
      const COOLDOWN_MS = 24 * 60 * 60 * 1000;
      if (isSelf && !isAdmin) {
        const timeSinceLastUpdate = Date.now() - (player.lastIgnUpdate || 0);
        if (timeSinceLastUpdate < COOLDOWN_MS) {
          const remainingTime = COOLDOWN_MS - timeSinceLastUpdate;
          const hours = Math.floor(remainingTime / (60 * 60 * 1000));
          const minutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
          
          return interaction.reply({
            content: `❌ You can only update your in-game username once every 24 hours. Please wait **${hours}h ${minutes}m** before trying again.`,
            ephemeral: true
          });
        }
      }

      // 6. Check if IGN is already taken (ignoring case)
      const existingPlayer = await PlayerModel.findOne({ 
        ingameUsername: { $regex: new RegExp(`^${newIgn}$`, 'i') } 
      });

      if (existingPlayer && existingPlayer.userId !== userToUpdate.id) {
        return interaction.reply({ 
          content: `❌ The in-game username **${newIgn}** is already being used by <@${existingPlayer.userId}>.`, 
          ephemeral: true 
        });
      }

      // 7. Update the player
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
    } finally {
      // 8. Always release the lock
      await redis.del(lockKey);
    }
  }
};
