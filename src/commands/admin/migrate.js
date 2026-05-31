const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../../models/Player');
const PlayerModel = require('../../models/PlayerSchema');
const { setElo } = require('../../utils/eloManager');
const { setPlayerCache, deletePlayerCache, redis } = require('../../utils/redisClient');
const { updateRankRoles } = require('../../utils/EloRank');
const { logStaffCommand } = require('../../utils/staffLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('migrate')
    .setDescription('Migrate PlayerStats data from one user to another.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('from')
        .setDescription('The user to migrate data FROM')
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName('to')
        .setDescription('The user to migrate data TO')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const fromUser = interaction.options.getUser('from');
    const toUser = interaction.options.getUser('to');

    if (fromUser.id === toUser.id) {
      return interaction.editReply('❌ Source and target users must be different.');
    }

    try {
      // 1. Fetch source data from MongoDB
      const fromDoc = await PlayerModel.findOne({ userId: fromUser.id });
      if (!fromDoc) {
        return interaction.editReply(`❌ No data found for user **${fromUser.tag}** (ID: ${fromUser.id}) in MongoDB.`);
      }

      // 2. Prepare data for migration
      const dataToMigrate = fromDoc.toObject();
      const elo = dataToMigrate.elo || 0;

      // 3. Update target user in MongoDB
      // We keep the target's userId and discordUsername, but migrate everything else
      await PlayerModel.findOneAndUpdate(
        { userId: toUser.id },
        {
          $set: {
            elo: elo,
            wins: dataToMigrate.wins || 0,
            losses: dataToMigrate.losses || 0,
            winstreak: dataToMigrate.winstreak || 0,
            mvps: dataToMigrate.mvps || 0,
            bedsBroken: dataToMigrate.bedsBroken || 0,
            prefix: dataToMigrate.prefix !== undefined ? dataToMigrate.prefix : true,
            recentlyPlayed: dataToMigrate.recentlyPlayed || [],
            lastPlayedAt: dataToMigrate.lastPlayedAt || 0,
            discordUsername: toUser.username,
            ingameUsername: dataToMigrate.ingameUsername || null,
            displayUsername: dataToMigrate.displayUsername || null,
            minecraftUuid: dataToMigrate.minecraftUuid || null,
            linkCode: dataToMigrate.linkCode || null,
            linkExpiry: dataToMigrate.linkExpiry || null
          }
        },
        { upsert: true }
      );

      // 4. Update Redis ELO for target user
      await setElo(toUser.id, elo);

      // 5. Update Redis Player Cache for target user
      const cacheData = {
        elo: elo,
        wins: dataToMigrate.wins || 0,
        losses: dataToMigrate.losses || 0,
        winstreak: dataToMigrate.winstreak || 0,
        mvps: dataToMigrate.mvps || 0,
        bedsBroken: dataToMigrate.bedsBroken || 0,
        prefix: dataToMigrate.prefix !== undefined ? dataToMigrate.prefix : true,
        recentlyPlayed: dataToMigrate.recentlyPlayed || [],
        lastPlayedAt: dataToMigrate.lastPlayedAt || 0,
        discordUsername: toUser.username,
        ingameUsername: dataToMigrate.ingameUsername || null,
        displayUsername: dataToMigrate.displayUsername || null
      };
      await setPlayerCache(toUser.id, cacheData);

      // 6. Delete source data from MongoDB and Redis
      await PlayerModel.deleteOne({ userId: fromUser.id });
      await deletePlayerCache(fromUser.id);
      await redis.del(`elo:${fromUser.id}`);

      // 7. Sync target user's nickname and roles if they are in the guild
      const toMember = await interaction.guild.members.fetch(toUser.id).catch(() => null);
      if (toMember) {
        // Reload player to ensure we have the latest data
        const player = await Player.load(toMember);
        await player.setNickname();
        await updateRankRoles(toMember, player.elo);
      }

      await interaction.editReply(`✅ Successfully migrated data from **${fromUser.tag}** to **${toUser.tag}**.`);
      await logStaffCommand(interaction);

    } catch (err) {
      console.error('[Migrate Command] Error:', err);
      await interaction.editReply('❌ An error occurred during migration. Check console logs.');
    }
  }
};
