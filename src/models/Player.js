const { getElo, setElo } = require('../utils/eloManager');
const { updateRankRoles } = require('../utils/EloRank');
const fs = require('fs');
const path = require('path');
const PlayerModel = require('./PlayerSchema');

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');
let stats = {};

if (fs.existsSync(STATS_PATH)) {
  try {
    stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  } catch (err) {
    console.error('[Player] Failed to parse playerStats.json:', err);
    stats = {};
  }
} else {
  fs.writeFileSync(STATS_PATH, JSON.stringify({}, null, 2));
}

function saveStats() {
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

class Player {
  /**
   * @param {GuildMember} member
   */
  constructor(member) {
    this.member = member;
    this.id = member.id;
    this.discordUsername = member.user.username;
    this.displayName = member.displayName;
    this.elo = getElo(this.id);

    if (!stats[this.id]) {
      stats[this.id] = {
        wins: 0,
        losses: 0,
        winstreak: 0,
        mvps: 0,
        bedsBroken: 0,
        prefix: true,
        recentlyPlayed: [],
        lastPlayedAt: 0,
        discordUsername: this.discordUsername,
        ingameUsername: null,
        displayUsername: null
      };
    }

    const playerStats = stats[this.id];
    this.discordUsername = playerStats.discordUsername || member.user.username;
    this.ingameUsername = playerStats.ingameUsername || null;
    this.displayUsername = playerStats.displayUsername || null;
    this.wins = playerStats.wins ?? 0;
    this.losses = playerStats.losses ?? 0;
    this.winstreak = playerStats.winstreak ?? 0;
    this.topKills = playerStats.mvps ?? 0;
    this.bedsBroken = playerStats.bedsBroken ?? 0;
    this.prefixEnabled = playerStats.prefix ?? true;
    this.recentlyPlayed = playerStats.recentlyPlayed ?? [];
    this.lastPlayedAt = playerStats.lastPlayedAt ?? 0;

    if (Date.now() - this.lastPlayedAt > 7 * 24 * 60 * 60 * 1000) {
      this.recentlyPlayed = [];
    }
  }

  static async load(member) {
    const player = new Player(member);
    try {
      const doc = await PlayerModel.findOne({ userId: member.id });
      if (doc) {
        player.ingameUsername = doc.ingameUsername;
        player.displayUsername = doc.displayUsername;
        stats[player.id].ingameUsername = doc.ingameUsername;
        stats[player.id].displayUsername = doc.displayUsername;
        player.elo = doc.elo;
      }
    } catch (err) {
      console.error(`[Player] Failed to load data from Mongo for ${member.id}:`, err);
    }
    return player;
  }

  get username() {
    return this.ingameUsername || this.discordUsername;
  }

  getWinGain() {
    const elo = this.elo;
    if (elo < 100) return 35;
    if (elo < 300) return 30;
    if (elo < 500) return 25;
    if (elo < 700) return 20;
    if (elo < 900) return 15;
    if (elo < 1400) return 10;
    return 5;
  }

  getLossPenalty() {
    const elo = this.elo;
    if (elo < 300) return 10;
    if (elo < 500) return 15;
    if (elo < 700) return 20;
    if (elo < 900) return 30;
    if (elo < 1100) return 35;
    if (elo < 1300) return 40;
    if (elo < 1500) return 50;
    if (elo < 1700) return 55;
    if (elo < 1900) return 65;
    return 70;
  }

  getMvpBonus() {
    if (this.elo <= 200) return 15;
    if (this.elo <= 400) return 10;
    return 5;
  }

  addRecentGame(gameId) {
    if (!gameId) return;
    const upper = String(gameId).toUpperCase();
    this.recentlyPlayed = [upper, ...this.recentlyPlayed.filter(id => id !== upper)];
    if (this.recentlyPlayed.length > 5) {
      this.recentlyPlayed.length = 5;
    }
    this.lastPlayedAt = Date.now();
  }

  async win(gameId, isMVP = false, isBedbreaker = false) {
    this.addRecentGame(gameId);
    const winGain = this.getWinGain();
    const mvpBonus = isMVP ? this.getMvpBonus() : 0;
    const bedBonus = isBedbreaker ? 5 : 0;
    this.elo += winGain + mvpBonus + bedBonus;
    this.wins += 1;
    this.winstreak += 1;
    await this.save();
  }

  async lose(gameId, isMVP = false) {
    this.addRecentGame(gameId);
    const penalty = this.getLossPenalty();
    const mvpReduction = isMVP ? this.getMvpBonus() : 0;
    const netLoss = Math.max(0, penalty - mvpReduction);
    this.elo = Math.max(0, this.elo - netLoss);
    this.losses += 1;
    this.winstreak = 0;
    await this.save();
  }

  async addTopKill() {
    this.topKills += 1;
    await this.save();
  }

  async addBedBroken() {
    this.bedsBroken += 1;
    await this.save();
  }

  async setBedsbroken(amount) {
    if (typeof amount !== 'number' || amount < 0) return;
    this.bedsBroken = amount;
    await this.save();
  }

  async setwin(amount) {
    if (typeof amount !== 'number' || amount < 0) return;
    this.wins = amount;
    await this.save();
  }

  async setmvps(amount) {
    if (typeof amount !== 'number' || amount < 0) return;
    this.topKills = amount;
    await this.save();
  }

  async setlose(amount) {
    if (typeof amount !== 'number' || amount < 0) return;
    this.losses = amount;
    await this.save();
  }

  async setWinstreak(amount) {
    if (typeof amount !== 'number' || amount < 0) return;
    this.winstreak = amount;
    await this.save();
  }

  async setElo(newElo) {
    this.elo = newElo;
    await this.save();
  }

  async setPrefixEnabled(state) {
    this.prefixEnabled = Boolean(state);
    await this.save();
  }

  async setIngameUsername(newName) {
    if (typeof newName !== 'string' || !newName.trim()) return;
    this.ingameUsername = newName.trim();
    await this.save();
  }

  async setDisplayUsername(newName) {
    this.displayUsername = newName ? newName.trim() : null;
    await this.save();
  }

  async setNickname() {
    const baseName = this.ingameUsername || this.discordUsername;
    const displayPart = this.displayUsername ? ` | ${this.displayUsername}` : '';
    const prefix = this.prefixEnabled ? `[${this.elo}] ` : '';
    const nickname = `${prefix}${baseName}${displayPart}`.substring(0, 32);
    await this.member.setNickname(nickname).catch(() => {});
  }

  async save() {
    await setElo(this.id, this.elo);
    stats[this.id] = {
      wins: this.wins,
      losses: this.losses,
      winstreak: this.winstreak,
      mvps: this.topKills,
      bedsBroken: this.bedsBroken,
      prefix: this.prefixEnabled,
      recentlyPlayed: this.recentlyPlayed,
      lastPlayedAt: this.lastPlayedAt,
      discordUsername: this.discordUsername,
      ingameUsername: this.ingameUsername,
      displayUsername: this.displayUsername
    };
    saveStats();

    // Update MongoDB
    try {
      await PlayerModel.findOneAndUpdate(
        { userId: this.id },
        {
          userId: this.id,
          elo: this.elo,
          wins: this.wins,
          losses: this.losses,
          winstreak: this.winstreak,
          mvps: this.topKills,
          bedsBroken: this.bedsBroken,
          prefix: this.prefixEnabled,
          recentlyPlayed: this.recentlyPlayed,
          lastPlayedAt: this.lastPlayedAt,
          discordUsername: this.discordUsername,
          ingameUsername: this.ingameUsername,
          displayUsername: this.displayUsername
        },
        { upsert: true }
      );
    } catch (err) {
      console.error(`[Player-Mongo] Failed to save for ${this.id}:`, err);
    }

    const baseName = this.ingameUsername || this.discordUsername;
    const displayPart = this.displayUsername ? ` | ${this.displayUsername}` : '';
    const prefix = this.prefixEnabled ? `[${this.elo}] ` : '';
    const nickname = `${prefix}${baseName}${displayPart}`.substring(0, 32);
    await this.member.setNickname(nickname).catch(() => {});
    await updateRankRoles(this.member, this.elo);
  }

  getWLR() {
    if (this.losses === 0) return this.wins === 0 ? 0 : this.wins;
    return (this.wins / this.losses).toFixed(2);
  }

  getStats() {
    return {
      wins: this.wins,
      losses: this.losses,
      winstreak: this.winstreak,
      topKills: this.topKills,
      bedsBroken: this.bedsBroken,
      wlr: this.getWLR(),
      prefix: this.prefixEnabled,
      recentlyPlayed: this.recentlyPlayed,
      discordUsername: this.discordUsername,
      ingameUsername: this.ingameUsername,
      displayUsername: this.displayUsername
    };
  }

  getResultSummary(result) {
    const displayName = this.ingameUsername || this.discordUsername;
    return {
      name: `${result === 'Win' ? '🏆 Win' : '❌ Loss'} - ${displayName}`,
      value: `ELO: \`${this.elo}\` ➝ \`${this.elo}\``, 
      inline: true,
    };
  }
}

module.exports = Player;
