const { redis } = require('./redisClient');
const PlayerModel = require('../models/PlayerSchema');

async function getElo(userId) {
  try {
    const elo = await redis.get(`elo:${userId}`);
    const parsed = parseInt(elo);
    return isNaN(parsed) ? 0 : parsed;
  } catch (err) {
    console.error(`[ELO] Failed to get ELO from Redis for ${userId}:`, err);
    return 0;
  }
}

async function setElo(userId, newElo) {
  const sanitizedElo = isNaN(parseInt(newElo)) ? 0 : parseInt(newElo);
  
  // Update Redis
  try {
    await redis.set(`elo:${userId}`, sanitizedElo);
  } catch (err) {
    console.error(`[ELO] Failed to set ELO in Redis for ${userId}:`, err);
  }

  // Update MongoDB
  try {
    await PlayerModel.findOneAndUpdate(
      { userId },
      { elo: sanitizedElo },
      { upsert: true }
    );
  } catch (err) {
    console.error(`[ELO-Mongo] Failed to update ELO for ${userId}:`, err);
  }
}

module.exports = {
  getElo,
  setElo,
};
