const Redis = require('ioredis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const onlineRedisConfig = require('../config/onlineRedis');

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

const onlineRedis = new Redis({
  host: onlineRedisConfig.host,
  port: onlineRedisConfig.port,
  username: onlineRedisConfig.username,
  password: onlineRedisConfig.password,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

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

onlineRedis.on('error', (err) => {
  console.error('[OnlineRedis] Connection Error:', err.message);
});

onlineRedis.on('connect', () => {
  console.log('[OnlineRedis] Connected to server.');
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

async function getPlayerOnlineStatus(userId, minecraftUuid, username) {
  try {
    let online = false;

    if (minecraftUuid) {
      try {
        online = await isPlayerOnlineByUuid(minecraftUuid);
      } catch (err) {
        console.error('[OnlineRedis] UUID lookup failed, falling back to username lookup:', err.message);
        online = username ? await isPlayerOnlineByName(username) : false;
      }
    } else if (username) {
      online = await isPlayerOnlineByName(username);
    }

    return {
      id: userId,
      minecraftUuid: minecraftUuid || null,
      username,
      status: online ? 'online' : 'offline'
    };
  } catch (err) {
    console.error('[OnlineRedis] Failed to get player online status:', err);
    return null;
  }
}

async function isPlayerOnlineByUuid(minecraftUuid) {
  const response = await onlineRedis.fcall('isPlayerOnline', 1, minecraftUuid);
  return parseOnlineBooleanResponse(response, 'online');
}

async function isPlayerOnlineByName(username) {
  const response = await onlineRedis.fcall('queryPlayerByAnyName', 1, username);
  return parseQueryPlayerResponse(response);
}

function parseOnlineBooleanResponse(response, fieldName) {
  if (response === null || response === undefined) return false;

  if (typeof response === 'boolean') return response;
  if (typeof response === 'number') return response !== 0;

  if (typeof response === 'object') {
    const value = response[fieldName] ?? response.online ?? response.status;
    if (value !== undefined) return parseOnlineBooleanResponse(value, fieldName);
    return false;
  }

  const text = String(response).trim();
  if (!text) return false;

  try {
    return parseOnlineBooleanResponse(JSON.parse(text), fieldName);
  } catch {
    return ['true', 'online', '1', 'yes'].includes(text.toLowerCase());
  }
}

function parseQueryPlayerResponse(response) {
  if (response === null || response === undefined) return false;

  if (typeof response === 'object') {
    if (typeof response.found === 'boolean') return response.found;
    if (typeof response.online === 'boolean') return response.online;
    if (typeof response.status === 'boolean') return response.status;
    if (response.data !== undefined) return parseQueryPlayerResponse(response.data);
  }

  const text = String(response).trim();
  if (!text) return false;

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      if (typeof parsed.found === 'boolean') return parsed.found;
      if (typeof parsed.online === 'boolean') return parsed.online;
      if (typeof parsed.status === 'boolean') return parsed.status;
      if (parsed.data !== undefined) return parseQueryPlayerResponse(parsed.data);
    }
    return parseOnlineBooleanResponse(parsed, 'online');
  } catch {
    return ['true', 'online', '1', 'yes'].includes(text.toLowerCase());
  }
}

function setupResultListener(client) {
  const resultsChannel = process.env.REDIS_RESULTS_CHANNEL || 'minecraft.results';

  console.log(`[Redis-Sub] Subscribing to ${resultsChannel}...`);
  redisSub.subscribe(resultsChannel);

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
    } catch (err) {
      console.error(`[Redis-Sub] Error processing message on ${chan}:`, err);
    }
  });
}

module.exports = {
  redis,
  redisSub,
  onlineRedis,
  publishMatch,
  getPlayerOnlineStatus,
  setupResultListener
};
