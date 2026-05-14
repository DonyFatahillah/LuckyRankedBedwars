const { ChannelType, PermissionFlagsBits } = require('discord.js');
const queue1v1 = require('../queue/queue1v1');
const queue2v2 = require('../queue/queue2v2');
const queue3v3 = require('../queue/queue3v3');
const queue4v4 = require('../queue/queue4v4');
const { getActiveGames, deleteActiveGame } = require('../queue/queueManager');
const Player = require('../models/Player');
const eloQueues = require('../config/eloQueues');
const { getPartyByUser } = require('../utils/partySystem');
const { trackJoin, trackLeave } = require('../utils/voiceJoinTracker');
const { getPlayerOnlineStatus } = require('../utils/redisClient');
require('dotenv').config({ path: __dirname + '/../.env' });

const RANKED_BANNED_ROLE_ID = process.env.RANKED_BANNED_ROLE_ID;
const BLACKLISTED_ROLE_ID = process.env.BLACKLISTED_ROLE_ID;
const WAITING_ROOM_VOICE_ID = process.env.WAITING_ROOM_VOICE_ID;

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

const queueLocks = new Map();
const deletedCategories = new Set();
const ONLINE_CHECK_TIMEOUT_MS = 5000;
const ONLINE_CHECK_INTERVAL_MS = 250;

module.exports = {
  name: 'voiceStateUpdate',

  async execute(oldState, newState) {
    const newChannelId = newState.channelId;
    const oldChannel = oldState.channel;

    console.log(`[voiceStateUpdate] ${oldState.channelId} → ${newChannelId}`);

    // Track Join/Leave for join time prioritization
    if (newChannelId) {
      trackJoin(newState.member.id);
    } else {
      trackLeave(newState.member.id);
    }

    // ───── Blacklist Check ─────
    if (newChannelId && ALL_QUEUE_IDS.includes(newChannelId)) {
      if (newState.member.roles.cache.has(BLACKLISTED_ROLE_ID)) {
        await moveToWaitingRoom(
          newState.member,
          '🚫 You are blacklisted from joining queue channels.'
        );
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
  const members = newState.channel.members;

  if (queueLocks.get(vcId)) return;
  queueLocks.set(vcId, true);

  try {
    // Collect players as GuildMember objects
    let players = party
      ? party.members.map(id => newState.guild.members.cache.get(id)).filter(Boolean)
      : [...members.values()];

    // Filter banned and ELO-ineligible players
    const validated = [];
    for (const member of players) {
      // 🚫 Banned players → move to waiting room
      if (member.roles.cache.has(RANKED_BANNED_ROLE_ID)) {
        await moveToWaitingRoom(
          member,
          '🚫 You are ranked banned and cannot queue.'
        );
        console.log(`[BanCheck] Moved banned player ${member.displayName} to waiting room`);
        continue;
      }

      if (member.roles.cache.has(BLACKLISTED_ROLE_ID)) {
        await moveToWaitingRoom(
          member,
          '🚫 You are blacklisted from joining queue channels.'
        );
        console.log(`[BlacklistCheck] Moved blacklisted player ${member.displayName} to waiting room from ${vcId}`);
        continue;
      }

      // ⚠️ ELO range validation
      const player = new Player(member);
      if (player.elo < eloQueue.minElo || player.elo > eloQueue.maxElo) {
        await moveToWaitingRoom(
          member,
          `❌ You must be between ${eloQueue.minElo}-${eloQueue.maxElo} ELO for ${eloQueue.type} queue.`
        );
        continue;
      }

      validated.push(member);
    }

    const expectedCount =
      eloQueue.type === '3v3' ? 6 :
      eloQueue.type === '4v4' ? 8 :
      2;

    if (validated.length < expectedCount) {
      console.log(`[Validate Queue] Not enough eligible players: ${validated.length}/${expectedCount}`);
      return;
    }

    const allOnline = await waitForOnlineChecks(validated, 'Validate Queue');
    if (!allOnline) return;

    console.log(`[Validate Queue] Starting ${eloQueue.type} match with ${validated.length} players.`);
    const queueModule = require(`../queue/queue${eloQueue.type}`);
    await queueModule.handleQueue(newState.guild, validated, eloQueue);

  } catch (err) {
    console.error(`[ELO Queue Error]`, err);
  } finally {
    setTimeout(() => queueLocks.set(vcId, false), 5000);
  }
}

// ───── Standard Queue Handling ─────
async function handleStandardQueue(newState, party = null) {
  const vcId = newState.channelId;
  const queue = queueHandlers[vcId];
  if (!queue || queueLocks.get(vcId)) return;

  const members = party
    ? party.members.map(id => newState.guild.members.cache.get(id)).filter(Boolean)
    : [...newState.channel.members.values()];

  // 🚫 Banned players → move to waiting room
  for (const member of members) {
    if (member.roles.cache.has(RANKED_BANNED_ROLE_ID)) {
      await moveToWaitingRoom(
        member,
        '🚫 You are ranked banned and cannot queue.'
      );
      console.log(`[BanCheck] Moved banned player ${member.displayName} to waiting room`);
      return;
    }
  }

  if (members.length < queue.expectedCount) return;

  try {
    queueLocks.set(vcId, true);

    const allOnline = await waitForOnlineChecks(members, 'Queue');
    if (!allOnline) return;

    console.log(`[Queue] Triggered ${queue.expectedCount}v${queue.expectedCount} queue with ${members.length} members.`);

    // Force high-tier logic for the test queue
    const config = vcId === process.env.QUEUE_1V1_TEST2_ID ? { minElo: 9999 } : null;
    await queue.handleQueue(newState.guild, members, config);
  } catch (err) {
    console.error(`[Queue Error] Failed in VC ${vcId}:`, err);
  } finally {
    setTimeout(() => queueLocks.set(vcId, false), 3000);
  }
}

async function waitForOnlineChecks(members, logPrefix) {
  const deadline = Date.now() + ONLINE_CHECK_TIMEOUT_MS;
  let statuses = await getOnlineStatuses(members);

  while (hasPendingOnlineCheck(statuses) && Date.now() < deadline) {
    const pending = statuses
      .filter(({ data }) => !data || data.status === 'check')
      .map(({ member }) => `${member.displayName} (${member.id})`)
      .join(', ');

    console.log(`[${logPrefix}] Waiting for Redis online check: ${pending}`);
    await sleep(ONLINE_CHECK_INTERVAL_MS);
    statuses = await getOnlineStatuses(members);
  }

  const unresolved = statuses.filter(({ data }) => !data || data.status === 'check');
  if (unresolved.length > 0) {
    console.log(`[${logPrefix}] Redis online check timed out for: ${formatMembers(unresolved)}`);
    return false;
  }

  const offline = statuses.filter(({ data }) => data.status !== 'online');
  if (offline.length > 0) {
    console.log(`[${logPrefix}] Queue blocked by non-online players: ${formatStatusMembers(offline)}`);
    return false;
  }

  return true;
}

async function getOnlineStatuses(members) {
  return Promise.all(members.map(async member => {
    const player = await Player.load(member);
    const username = player.ingameUsername || member.user.username;

    return {
      member,
      data: await getPlayerOnlineStatus(member.id, player.minecraftUuid, username)
    };
  }));
}

function hasPendingOnlineCheck(statuses) {
  return statuses.some(({ data }) => !data || data.status === 'check');
}

function formatMembers(entries) {
  return entries.map(({ member }) => `${member.displayName} (${member.id})`).join(', ');
}

function formatStatusMembers(entries) {
  return entries
    .map(({ member, data }) => `${member.displayName} (${member.id}): ${data?.status || 'unknown'}`)
    .join(', ');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// â”€â”€â”€â”€â”€ Move to Waiting Room (for ELO-ineligible players) â”€â”€â”€â”€â”€
async function moveToWaitingRoom(member, message) {
  try {
    if (!WAITING_ROOM_VOICE_ID) return;
    const waitingRoom = member.guild.channels.cache.get(WAITING_ROOM_VOICE_ID);
    if (waitingRoom && member.voice.channelId !== WAITING_ROOM_VOICE_ID) {
      await member.voice.setChannel(waitingRoom).catch(() => {});
    }
    await member.send(message).catch(() => {});
    console.log(`[ELOCheck] Moved ${member.displayName} to waiting room.`);
  } catch (err) {
    console.error(`[MoveToWaitingRoom Error]`, err);
  }
}

// ───── Cleanup Logic ─────
async function handleCategoryCleanup(leftChannel) {
  const category = leftChannel.parent;
  const categoryId = category?.id;
  if (!categoryId || deletedCategories.has(categoryId)) return;

  console.log(`[Cleanup Debug] Checking cleanup for category: ${category.name} (${categoryId})`);

  const matchEntry = [...getActiveGames().entries()].find(([, data]) => data.categoryId === categoryId);
  if (!matchEntry) {
    console.log(`[Cleanup Debug] No active match found for category ${categoryId}`);
    return;
  }

  const [gameId, matchData] = matchEntry;
  if (matchData.status === 'pending') {
    console.log(`[Cleanup] Game #${gameId} is pending. Skipping cleanup.`);
    return;
  }

  const voiceChannels = category.children.cache.filter(c => c.type === ChannelType.GuildVoice);
  const allEmpty = voiceChannels.every(vc => vc.members.size === 0);

  if (!allEmpty) return;

  console.log(`[Cleanup] All voice channels in game #${gameId} are empty or moving. Deleting...`);
  deletedCategories.add(categoryId);

  const waitingRoomId = process.env.WAITING_ROOM_VOICE_ID;
  const waitingRoom = waitingRoomId ? leftChannel.guild.channels.cache.get(waitingRoomId) : null;

  for (const channel of category.children.cache.values()) {
    if (channel.type === ChannelType.GuildVoice && waitingRoom) {
      await Promise.all(channel.members.map(m => m.voice.setChannel(waitingRoom).catch(() => {})));
    }
    await channel.delete().catch(err => { if (err.code !== 10003) console.error(err); });
  }

  await category.delete().catch(err => { if (err.code !== 10003) console.error(err); });
  deleteActiveGame(gameId);
  setTimeout(() => deletedCategories.delete(categoryId), 5000);
}
