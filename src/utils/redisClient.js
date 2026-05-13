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

async function publishPlayerOnline(userId, username, status) {
  const channel = 'player.online';
  try {
    const payload = JSON.stringify({ id: userId, username, status });
    await redis.publish(channel, payload);
    console.log(`[Redis] Player ${username} (${userId}) status "${status}" published to ${channel}`);
  } catch (err) {
    console.error('[Redis] Failed to publish player online event:', err);
  }
}

function setupResultListener(client) {
  const resultsChannel = process.env.REDIS_RESULTS_CHANNEL || 'minecraft.results';
  const onlineChannel = 'player.online';
  
  console.log(`[Redis-Sub] Subscribing to ${resultsChannel} and ${onlineChannel}...`);
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
        // Ignore our own requests (if we send "check")
        if (data.status === 'check') return;

        console.log(`[Redis-Sub] Player ${data.username} is ${data.status} (from plugin)`);
        
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

module.exports = {
  redis,
  redisSub,
  publishMatch,
  publishPlayerOnline,
  setupResultListener
};
