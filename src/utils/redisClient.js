const Redis = require('ioredis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

const redisSub = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

const PLAYER_STATUS_KEY_PREFIX = 'player.online.status:';
const PLAYER_STATUS_TTL_SECONDS = 30;

function getPlayerStatusKey(userId) {
  return `${PLAYER_STATUS_KEY_PREFIX}${userId}`;
}

redis.on('error', (err) => {
  console.error('[Redis] Connection Error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected to server.');
});

redisSub.on('error', (err) => {
  console.error('[Redis-Sub] Connection Error:', err.message);
});

redisSub.on('connect', () => {
  console.log('[Redis-Sub] Connected to server.');
});

async function publishMatch(matchData) {
  const channel = process.env.REDIS_CHANNEL || 'minecraft.matches';
  try {
    const payload = JSON.stringify(matchData);
    await redis.publish(channel, payload);
    console.log(`[Redis] Match #${matchData.matchId} published to ${channel}`);
  } catch (err) {
    console.error('[Redis] Failed to publish match:', err);
  }
}

async function publishMatchVoid(matchData) {
  const voidchannel = process.env.REDIS_VOID_CHANNEL || 'minecraft.matches.void';
  try {
    const payload = JSON.stringify(matchData);
    await redis.publish(voidchannel, payload);
    console.log(`[Redis] Match #${matchData.matchId} published to ${voidchannel}`);
  } catch (err) {
    console.error('[Redis] Failed to publish match void:', err);
  }
}

async function publishPlayerOnline(userId, username, status) {
  const channel = 'player.online';
  try {
    const data = { id: userId, username, status };
    const payload = JSON.stringify(data);
    if (status !== 'check') {
      await redis.set(getPlayerStatusKey(userId), payload, 'EX', PLAYER_STATUS_TTL_SECONDS);
    }
    await redis.publish(channel, payload);
    console.log(`[Redis] Player ${username} (${userId}) status "${status}" published to ${channel}`);
  } catch (err) {
    console.error('[Redis] Failed to publish player online event:', err);
  }
}

async function getPlayerOnlineStatus(userId) {
  try {
    const payload = await redis.get(getPlayerStatusKey(userId));
    return payload ? JSON.parse(payload) : null;
  } catch (err) {
    console.error('[Redis] Failed to get player online status:', err);
    return null;
  }
}

const WAITING_ROOM_VOICE_ID = process.env.WAITING_ROOM_VOICE_ID;
const ALLSTARS_VOICE_IDS = [
  process.env.TEAM_1_VOICE_ID,
  process.env.TEAM_2_VOICE_ID,
  process.env.TEAM_3_VOICE_ID,
  process.env.TEAM_4_VOICE_ID,
].filter(Boolean);

function setupResultListener(client) {
  const resultsChannel = process.env.REDIS_RESULTS_CHANNEL || 'minecraft.results';
  const onlineChannel = 'player.online';
  const voidChannel = 'minecraft.matches.void';
  
  console.log(`[Redis-Sub] Subscribing to ${resultsChannel}, ${voidChannel}, and ${onlineChannel}...`);
  redisSub.subscribe(resultsChannel, onlineChannel);

  redisSub.on('message', async (chan, message) => {
    try {
      const data = JSON.parse(message);

      if (chan === resultsChannel) {
        console.log(`[Redis-Sub] Received result for Match #${data.matchId}`);

        const autoConfirmMatch = require('./autoConfirmMatch');
        const guild = await client.guilds.fetch(process.env.GUILD_ID);

        if (!guild) {
          console.error('[Redis-Sub] Guild not found for auto-confirmation');
          return;
        }

        await autoConfirmMatch(client, guild, data.matchId, {
          winner: data.winner,
          topKiller: data.topKiller,
          winBedbreaker: data.winBedbreaker,
          loseBedbreaker: data.loseBedbreaker
        });
      } 
      
      else if (chan === onlineChannel) {
        console.log(`[Redis-Sub] Received online update:`, data);
        
        // Ignore our own requests from being cached or processed further
        if (data.status === 'check') return;

        if (data.id && data.status) {
          await redis.set(getPlayerStatusKey(data.id), message, 'EX', PLAYER_STATUS_TTL_SECONDS);
        }

        let displayName = data.username;
        if (data.id) {
          try {
            const cached = await getPlayerCache(data.id);
            if (cached && cached.ingameUsername) {
              displayName = cached.ingameUsername;
            } else {
              const PlayerModel = require('../models/PlayerSchema');
              const doc = await PlayerModel.findOne({ userId: data.id });
              if (doc && doc.ingameUsername) {
                displayName = doc.ingameUsername;
              }
            }
          } catch (err) {
            console.error('[Redis-Sub] Error fetching player ingameUsername:', err);
          }
        }

        console.log(`[Redis-Sub] Player ${displayName} is ${data.status} (from plugin)`);
        
        if (data.status === 'offline') {
          try {
            const guildId = process.env.GUILD_ID;
            const waitingRoomId = process.env.WAITING_ROOM_VOICE_ID;
            
            if (!guildId || !waitingRoomId || !data.id) return;

            const guild = await client.guilds.fetch(guildId);
            if (!guild) return;

            // Instantly fetch the specific member by ID - No more rate-limiting search!
            const member = await guild.members.fetch(data.id).catch(() => null);

            if (member && member.voice.channelId && member.voice.channelId !== waitingRoomId) {
              const waitingRoom = await guild.channels.fetch(waitingRoomId);
              if (waitingRoom) {
                await member.voice.setChannel(waitingRoom);
                await member.send(`⚠️ You were moved to the waiting room because you are not online in-game. Please join the server to queue.`).catch(() => {});
                console.log(`[Redis-Sub] Moved ${member.displayName} to waiting room (Offline)`);
              }
            }
          } catch (err) {
            console.error('[Redis-Sub] Error moving offline player:', err);
          }
        }
      }

    } catch (err) {
      console.error(`[Redis-Sub] Error processing message on ${chan}:`, err);
      
    }
  });
}

const DATA_CACHE_CHANNEL = 'data.cache';

async function publishDataCacheInvalidation(key) {
  try {
    await redis.publish(DATA_CACHE_CHANNEL, JSON.stringify({ action: 'invalidate', key }));
    // console.log(`[Redis] Invalidation event published to ${DATA_CACHE_CHANNEL} for key: ${key}`);
  } catch (err) {
    console.error(`[Redis] Failed to publish invalidation to ${DATA_CACHE_CHANNEL}:`, err);
  }
}

async function setPlayerCache(userId, data) {
  try {
    await redis.set(`player.cache:${userId}`, JSON.stringify(data), 'EX', 3600); // Cache for 1 hour
    await publishDataCacheInvalidation(`player.cache:${userId}`);
  } catch (err) {
    console.error(`[Redis] Failed to cache player ${userId}:`, err);
  }
}
// ... rest of the file ...

async function getPlayerCache(userId) {
  try {
    const data = await redis.get(`player.cache:${userId}`);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`[Redis] Failed to get player cache ${userId}:`, err);
    return null;
  }
}

async function deletePlayerCache(userId) {
  try {
    await redis.del(`player.cache:${userId}`);
  } catch (err) {
    console.error(`[Redis] Failed to delete player cache ${userId}:`, err);
  }
}

module.exports = {
  redis,
  redisSub,
  publishMatch,
  publishMatchVoid,
  publishPlayerOnline,
  getPlayerOnlineStatus,
  setupResultListener,
  setPlayerCache,
  getPlayerCache,
  deletePlayerCache
};
