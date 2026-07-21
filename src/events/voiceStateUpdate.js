const { ChannelType, PermissionFlagsBits } = require('discord.js');
const queue1v1 = require('../queue/queue1v1');
const queue2v2 = require('../queue/queue2v2');
const queue3v3 = require('../queue/queue3v3');
const queue4v4 = require('../queue/queue4v4');
const { getActiveGames, deleteActiveGame, queueLocks, validateQueueMembers, moveIneligiblePlayer } = require('../queue/queueManager');
const Player = require('../models/Player');
const eloQueues = require('../config/eloQueues');
const { getPartyByUser } = require('../utils/partySystem');
const { trackJoin, trackLeave } = require('../utils/voiceJoinTracker');
const { publishPlayerOnline, getPlayerOnlineStatus } = require('../utils/redisClient');
require('dotenv').config({ path: __dirname + '/../.env' });

const RANKED_BANNED_ROLE_ID = process.env.RANKED_BANNED_ROLE_ID;
const BLACKLISTED_ROLE_ID = process.env.BLACKLISTED_ROLE_ID;
const WAITING_ROOM_VOICE_ID = process.env.WAITING_ROOM_VOICE_ID;

// Allstars Team Voice IDs
const ALLSTARS_VOICE_IDS = [
  process.env.TEAM_1_VOICE_ID,
  process.env.TEAM_2_VOICE_ID,
  process.env.TEAM_3_VOICE_ID,
  process.env.TEAM_4_VOICE_ID,
].filter(Boolean);

const queueHandlers = {
  [process.env.QUEUE_1V1_TEST_ID]: queue1v1,
  [process.env.QUEUE_1V1_TEST2_ID]: queue1v1,
  [process.env.QUEUE_2V2_TEST_ID]: queue2v2,
  [process.env.QUEUE_3V3_TEST_ID]: queue3v3,
  [process.env.QUEUE_4V4_TEST_ID]: queue4v4,
};

// Collect all queue channel IDs from environment variables
const ALL_QUEUE_IDS = Object.entries(process.env)
  .filter(([key, value]) => key.includes('QUEUE') && value && /^\d{17,19}$/.test(value))
  .map(([, value]) => value);

const deletedCategories = new Set();
const pendingCleanups = new Set();
const ONLINE_CHECK_TIMEOUT_MS = 10000;
const ONLINE_CHECK_INTERVAL_MS = 250;

module.exports = {
  name: 'voiceStateUpdate',

  async execute(oldState, newState) {
    const newChannelId = newState.channelId;
    const oldChannel = oldState.channel;

    const eloQueue = eloQueues.find(q => q.voiceChannelId === newChannelId || q.voiceChannelId === oldState.channelId);
    const isStandardQueue = ALL_QUEUE_IDS.includes(newChannelId) || ALL_QUEUE_IDS.includes(oldState.channelId);

    if (eloQueue || isStandardQueue) {
      const oldChannelName = oldState.channel ? oldState.channel.name : 'None';
      const newChannelName = newState.channel ? newState.channel.name : 'None';
      console.log(`[voiceStateUpdate] ${newState.member.displayName} moved: ${oldChannelName} → ${newChannelName}`);
    }

    // Track Join/Leave for join time prioritization
    if (newChannelId) {
      trackJoin(newState.member.id);
    } else {
      trackLeave(newState.member.id);
    }

    // ───── Allstars Online Check ─────
    if (newChannelId && ALLSTARS_VOICE_IDS.includes(newChannelId)) {
      console.log(`[Allstars-Guard] ${newState.member.displayName} joined team voice. Requesting fresh online check...`);
      
      const player = await Player.load(newState.member);
      const username = player.ingameUsername || newState.member.user.username;
      
      const ign = player.ingameUsername || newState.member.id;
      // Request a fresh check from the Minecraft plugin
      await publishPlayerOnline(ign, username, 'check');

      // Wait a short bit for the plugin to respond via the Redis listener
      await new Promise(resolve => setTimeout(resolve, 1500));

      const onlineStatus = await getPlayerOnlineStatus(ign);
      const isOnline = onlineStatus && (onlineStatus.status === 'online' || onlineStatus.status === 'check');

      if (!isOnline) {
        console.log(`[Allstars-Guard] Player ${newState.member.displayName} (${newState.member.id}) status check failed after fresh request. Status:`, onlineStatus);
        if (WAITING_ROOM_VOICE_ID) {
          await newState.member.voice.setChannel(WAITING_ROOM_VOICE_ID).catch(() => {});
          await newState.member.send(`⚠️ You were moved to the waiting room because you are not online in-game. Please join the server to join Allstars team voices.`).catch(() => {});
        }
        return;
      }
    }

    // ───── Blacklist Check ─────
    if (newChannelId && ALL_QUEUE_IDS.includes(newChannelId)) {
      if (newState.member.roles.cache.has(BLACKLISTED_ROLE_ID)) {
        await moveIneligiblePlayer(newState.member, 'blacklisted');
        console.log(`[BlacklistCheck] Moved blacklisted player ${newState.member.displayName} to waiting room from ${newChannelId}`);
        return;
      }
    }

    // ───── Party Mode Handling ─────
    const party = getPartyByUser(newState.member.id);
    if (party) {
      console.log(`[Party] Member ${newState.member.id} is in party led by ${party.leaderId}`);
      if (newState.member.id !== party.leaderId) {
        // Move follower to leader's VC if leader moved
        const leaderMember = await newState.guild.members.fetch(party.leaderId).catch(() => null);
        if (leaderMember?.voice.channelId && newState.member.voice.channelId !== leaderMember.voice.channelId) {
          await newState.member.voice.setChannel(leaderMember.voice.channelId).catch(() => {});
          console.log(`[Party] Moved ${newState.member.displayName} to follow leader ${leaderMember.displayName}`);
        }
        return;
      }
    }

    // ───── Queue Join Logic ─────
    if (newChannelId) {
      const eloQueue = eloQueues.find(q => q.voiceChannelId === newChannelId);
      const isStandardQueue = ALL_QUEUE_IDS.includes(newChannelId);

      if (eloQueue || isStandardQueue) {
        // Request a check ONLY for the person who joined if they aren't already cached online
        const player = await Player.load(newState.member);
        const username = player.ingameUsername || newState.member.user.username;
        const ign = player.ingameUsername || newState.member.id;
        
        const currentStatus = await getPlayerOnlineStatus(ign);
        if (!currentStatus || (currentStatus.status !== 'online' && currentStatus.status !== 'check')) {
          await publishPlayerOnline(ign, username, 'check');
          console.log(`[QueueJoin] ${newState.member.displayName} joined queue ${newChannelId}. Requested fresh check.`);
        } else {
          console.log(`[QueueJoin] ${newState.member.displayName} joined queue ${newChannelId}. Already known online.`);
        }
      }

      if (eloQueue) {
        await handleEloQueue(newState, eloQueue, party);
      } else {
        await handleStandardQueue(newState, party);
      }
    }

    // ───── Cleanup on Leave ─────
    if (oldChannel && oldChannel.parent?.type === ChannelType.GuildCategory) {
      await handleCategoryCleanup(oldChannel);
    }
  }
};

// ───── ELO-Based Queue Handling ─────
async function handleEloQueue(newState, eloQueue, party = null) {
  const vcId = newState.channelId;
  const voiceChannel = newState.channel;

  if (queueLocks.get(vcId)) return;

  try {
    // Perform thorough validation of ALL members in the queue
    const validated = await validateQueueMembers(newState.guild, voiceChannel, eloQueue, { forceCheck: false, wait: true });

    const expectedCount =
      eloQueue.type === '3v3' ? 6 :
      eloQueue.type === '4v4' ? 8 :
      2;

    if (validated.length < expectedCount) {
      console.log(`[Validate Queue] Not enough eligible players: ${validated.length}/${expectedCount}`);
      return;
    }

    console.log(`[Validate Queue] Starting ${eloQueue.type} match with ${validated.length} players.`);
    
    // Set lock BEFORE triggering to avoid parallel matches
    queueLocks.set(vcId, true);
    
    const queueModule = require(`../queue/queue${eloQueue.type}`);
    await queueModule.handleQueue(newState.guild, validated, eloQueue);

  } catch (err) {
    console.error(`[ELO Queue Error]`, err);
    queueLocks.delete(vcId);
  } finally {
    setTimeout(() => queueLocks.delete(vcId), 10000);
  }
}

// ───── Standard Queue Handling ─────
async function handleStandardQueue(newState, party = null) {
  const vcId = newState.channelId;
  const queue = queueHandlers[vcId];
  if (!queue || queueLocks.get(vcId)) return;

  const voiceChannel = newState.channel;

  try {
    // Perform thorough validation of ALL members in the queue
    // Standard queues don't have min/max ELO but still need online check, banned check, etc.
    const validated = await validateQueueMembers(newState.guild, voiceChannel, { type: queue.expectedCount + 'v' + queue.expectedCount }, { forceCheck: false, wait: true });

    if (validated.length < queue.expectedCount) return;

    console.log(`[Queue] Triggered ${queue.expectedCount}v${queue.expectedCount} queue with ${validated.length} members.`);

    // Set lock BEFORE triggering
    queueLocks.set(vcId, true);

    // Force high-tier logic for the test queue
    const config = vcId === process.env.QUEUE_1V1_TEST2_ID ? { minElo: 9999 } : null;
    await queue.handleQueue(newState.guild, validated, config);
  } catch (err) {
    console.error(`[Queue Error] Failed in VC ${vcId}:`, err);
    queueLocks.delete(vcId);
  } finally {
    setTimeout(() => queueLocks.delete(vcId), 10000);
  }
}

// ───── Cleanup Logic ─────
async function handleCategoryCleanup(leftChannel) {
  const category = leftChannel.parent;
  const categoryId = category?.id;
  if (!categoryId || deletedCategories.has(categoryId)) return;

  // --- Only proceed if this looks like a match category (Game | HEXCODE or #HEXCODE Game) ---
  const matchHexRegex = /(?:^#([0-9A-F]{6})\b|^Game\s*\|\s*([0-9A-F]{6})\b)/i;
  if (!matchHexRegex.test(category.name)) return;

  console.log(`[Cleanup Debug] Checking cleanup for category: ${category.name} (${categoryId})`);

  const activeGames = await getActiveGames();
  const matchData = activeGames.find(data => data.categoryId === categoryId);
  
  if (!matchData) {
    console.log(`[Cleanup Debug] No active match found for category ${categoryId}`);
    return;
  }

  const gameId = matchData.gameId;
  const voiceChannels = category.children.cache.filter(c => c.type === ChannelType.GuildVoice);
  const allEmpty = voiceChannels.every(vc => vc.members.size === 0);

  if (!allEmpty) {
    if (pendingCleanups.has(categoryId)) {
      console.log(`[Cleanup] Someone rejoined game #${gameId}. Canceling cleanup.`);
      pendingCleanups.delete(categoryId);
    }
    return;
  }

  if (pendingCleanups.has(categoryId)) return;

  console.log(`[Cleanup] Game #${gameId} is empty. Waiting 30 seconds before cleanup...`);
  pendingCleanups.add(categoryId);

  await new Promise(resolve => setTimeout(resolve, 30000));

  if (!pendingCleanups.has(categoryId)) return;
  pendingCleanups.delete(categoryId);

  // Re-fetch category and double check emptiness just in case
  const freshCategory = await leftChannel.guild.channels.fetch(categoryId).catch(() => null);
  if (!freshCategory) return;

  const freshVoiceChannels = freshCategory.children.cache.filter(c => c.type === ChannelType.GuildVoice);
  const freshAllEmpty = freshVoiceChannels.every(vc => vc.members.size === 0);

  if (!freshAllEmpty) return;

  if (matchData.status === 'pending') {
    console.log(`[Cleanup] Game #${gameId} is pending and empty. Voiding it...`);
    const { updateMatchStatus, editLogEmbed } = require('../utils/matchLogger');
    const { publishMatchVoid } = require('../utils/redisClient');
    
    const reason = 'Players abandoned the voice channels';
    const guildId = category.guild.id;
    const client = leftChannel.client;

    await updateMatchStatus(gameId, 'void');
    await editLogEmbed(client, guildId, gameId, process.env.STAFF_VERIFY_CHANNEL_ID, 'void', { reason });
    await editLogEmbed(client, guildId, gameId, process.env.MATCH_LOGS_ID, 'void', { reason });
    await editLogEmbed(client, guildId, gameId, process.env.VERIFY_MATCH_CHANNEL_ID, 'void', { reason });
    await publishMatchVoid({ matchId: gameId, action: 'void' }).catch(() => {});
  } else {
    console.log(`[Cleanup] Game #${gameId} is empty. Deleting...`);
  }

  deletedCategories.add(categoryId);

  const waitingRoomId = process.env.WAITING_ROOM_VOICE_ID;
  const waitingRoom = waitingRoomId ? leftChannel.guild.channels.cache.get(waitingRoomId) : null;

  for (const channel of freshCategory.children.cache.values()) {
    if (channel.type === ChannelType.GuildVoice && waitingRoom) {
      await Promise.all(channel.members.map(m => m.voice.setChannel(waitingRoom).catch(() => {})));
    }
    await channel.delete().catch(err => { if (err.code !== 10003) console.error(err); });
  }

  await freshCategory.delete().catch(err => { if (err.code !== 10003) console.error(err); });
  deleteActiveGame(gameId);
  setTimeout(() => deletedCategories.delete(categoryId), 5000);
}
