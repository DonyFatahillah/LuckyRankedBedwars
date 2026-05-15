const ActiveGameModel = require('./ActiveGameSchema');
const { redis } = require('../utils/redisClient');

class ActiveGame {
  constructor(data) {
    this.gameId = data.gameId;
    this.channelId = data.channelId;
    this.categoryId = data.categoryId;
    this.queueType = data.queueType;
    this.players = data.players || [];
    this.teamA = data.teamA || [];
    this.teamB = data.teamB || [];
    this.map = data.map;
    this.voiceAId = data.voiceAId;
    this.voiceBId = data.voiceBId;
    this.startedAt = data.startedAt || Date.now();
    this.submitted = data.submitted || false;
    this.submittingTeam = data.submittingTeam || null;
  }

  static async load(gameId) {
    // 1. Try Redis
    let data = await redis.get(`game:${gameId}`);
    if (data) return new ActiveGame(JSON.parse(data));

    // 2. Try MongoDB
    const doc = await ActiveGameModel.findOne({ gameId });
    if (doc) {
      const game = new ActiveGame(doc);
      await game.cache();
      return game;
    }
    return null;
  }

  async cache() {
    await redis.set(`game:${this.gameId}`, JSON.stringify(this));
  }

  async save() {
    await this.cache();
    await ActiveGameModel.findOneAndUpdate(
      { gameId: this.gameId },
      { ...this },
      { upsert: true }
    );
  }

  async delete() {
    await redis.del(`game:${this.gameId}`);
    await ActiveGameModel.deleteOne({ gameId: this.gameId });
  }

  setSubmitted(team) {
    this.submitted = true;
    this.submittingTeam = team;
  }
}

module.exports = ActiveGame;
