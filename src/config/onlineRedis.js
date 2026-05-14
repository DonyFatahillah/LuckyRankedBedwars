module.exports = {
  host: process.env.ONLINE_REDIS_HOST || process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.ONLINE_REDIS_PORT || process.env.REDIS_PORT || 6379),
  username: process.env.ONLINE_REDIS_USERNAME || process.env.REDIS_USERNAME || undefined,
  password: process.env.ONLINE_REDIS_PASSWORD || process.env.REDIS_PASSWORD || undefined,
  key: process.env.ONLINE_REDIS_KEY || 'OnlinePlayerRegistry',
};
