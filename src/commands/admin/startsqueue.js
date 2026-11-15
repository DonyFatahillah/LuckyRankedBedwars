const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eloQueues = require('../../config/eloQueues');
const { createMatch, validateQueueMembers, queueLocks, getActiveGames } = require('../../queue/queueManager');
const mapPicker = require('../../utils/mapPicker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('startsqueue')
    .setDescription('Debug: start your doubles queue with 2 or 4 players (arena voting enabled)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ This debugging command is administrator-only.', flags: [64] });
    }
    await interaction.deferReply({ flags: [64] });

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const channel = member.voice?.channel;
    const queue = channel && eloQueues.find(q => q.voiceChannelId === channel.id && q.isDebug && q.type === '2v2');
    if (!queue) {
      return interaction.editReply('❌ Join the configured doubles CROSS or SIDE debug queue voice channel first.');
    }
    if (queueLocks.get(channel.id)) {
      return interaction.editReply('⚠️ This queue is already being processed. Try again shortly.');
    }

    queueLocks.set(channel.id, true);
    try {
      const members = [...channel.members.values()];
      if (![2, 4].includes(members.length) || members.some(m => m.user.bot)) {
        return await interaction.editReply('❌ Use exactly 2 or 4 human players. Two players test one account per team; four players start a full 2v2.');
      }
      if (mapPicker.getRandomMaps(1, '2v2').length === 0) {
        return await interaction.editReply('❌ Add your doubles maps under `maps_2v2` in `data/mapList.yaml` and reload the bot first.');
      }
      const activeGames = await getActiveGames();
      if (activeGames.some(game => game && game.players?.some(id => members.some(m => m.id === id)))) {
        return await interaction.editReply('❌ A player is already in an active match. Finish or void that match first.');
      }

      // Keep normal online/banned/Elo validation; this command only lowers the player count.
      const eligible = await validateQueueMembers(interaction.guild, channel, queue, { forceCheck: true, wait: true });
      if (eligible.length !== members.length || eligible.some(m => m.voice.channelId !== channel.id)) {
        return await interaction.editReply('❌ All players must remain in the queue and pass the usual online/eligibility checks.');
      }

      // A team size of 1 splits two testers (even a party) into opposite teams.
      // The queue override still identifies the match as 2v2_CROSS/SIDE for maps and Redis.
      const captains = await createMatch(interaction.guild, eligible, members.length / 2, {
        isPartyMatch: members.length === 4,
        eloQueue: queue
      });
      if (!captains) {
        return await interaction.editReply('❌ Match could not start. Check linked IGNs, online status, and bot logs.');
      }
      await interaction.editReply(`✅ Started ${queue.redisQueueType} with ${members.length} players. Arena voting is in the match chat.${members.length === 2 ? ' Debug test: one player per team, even if partied.' : ''} This uses the real match pipeline; do not submit/confirm test results if you want to avoid affecting stats.`);
    } catch (err) {
      console.error('[StartsQueue] Failed:', err);
      await interaction.editReply('❌ Could not start the debug match. Check the bot logs.');
    } finally {
      queueLocks.delete(channel.id);
    }
  }
};
