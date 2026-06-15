const Redis = require('ioredis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
});

const redisSub = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
});

const CHECK_CHANNEL = 'allstars.tournament.check';
const CONFIRMED_CHANNEL = 'allstars.tournament.confirmed';

async function test() {
    console.log('Subscribing to confirmed channel...');
    redisSub.subscribe(CONFIRMED_CHANNEL);

    redisSub.on('message', (channel, message) => {
        if (channel === CONFIRMED_CHANNEL) {
            console.log('RECEIVED CONFIRMATION:');
            console.log(JSON.stringify(JSON.parse(message), null, 2));
            process.exit(0);
        }
    });

    const mockData = {
        action: "CHECK",
        requestId: "test-request-id-" + Date.now(),
        admin: "TestAdmin",
        team1Name: "Team1",
        team2Name: "Team2",
        team1: [],
        team2: [],
        timestamp: Date.now()
    };

    console.log('Publishing mock CHECK message...');
    await redis.publish(CHECK_CHANNEL, JSON.stringify(mockData));
    console.log('Sent. Waiting for confirmation (make sure the bot is running and configured)...');

    // Timeout after 10 seconds
    setTimeout(() => {
        console.log('Timed out waiting for confirmation.');
        process.exit(1);
    }, 10000);
}

test().catch(console.error);
