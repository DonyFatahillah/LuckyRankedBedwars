const { redis } = require('./redisClient');
const PlayerModel = require('../models/PlayerSchema');

async function getElo(userId) {
  try {
    const elo = await redis.get(`elo:${userId}`);
    return elo ? parseInt(elo) : 0;
  } catch (err) {
    console.error(`[ELO] Failed to get ELO from Redis for ${userId}:`, err);
    return 0;
  }
}

async function setElo(userId, newElo) {
  // Update Redis
  try {
    await redis.set(`elo:${userId}`, newElo);
  } catch (err) {
    console.error(`[ELO] Failed to set ELO in Redis for ${userId}:`, err);
  }

  // Update MongoDB
  try {
    await PlayerModel.findOneAndUpdate(
      { userId },
      { elo: newElo },
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
