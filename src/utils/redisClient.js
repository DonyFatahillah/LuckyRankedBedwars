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

function setupResultListener(client) {
  const channel = process.env.REDIS_RESULTS_CHANNEL || 'minecraft.results';
  
  console.log(`[Redis-Sub] Subscribing to ${channel}...`);
  redisSub.subscribe(channel);

  redisSub.on('message', async (chan, message) => {
    if (chan === channel) {
      try {
        const data = JSON.parse(message);
        console.log(`[Redis-Sub] Received result for Match #${data.matchId}`);

        // Lazy load to avoid circular dependency or early load issues
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

      } catch (err) {
        console.error('[Redis-Sub] Error processing match result:', err);
      }
    }
  });
}

module.exports = {
  redis,
  redisSub,
  publishMatch,
  setupResultListener
};
