const PlayerModel = require('../models/PlayerSchema');

let eloData = {};

// Refresh cache from MongoDB
async function refresh() {
  try {
    const players = await PlayerModel.find({}, 'userId elo').lean();
    eloData = {};
    for (const p of players) {
      eloData[p.userId] = p.elo;
    }
    console.log(`[ELO Cache] Loaded ${players.length} player entries from MongoDB`);
  } catch (err) {
    console.error('[ELO Cache] Failed to load from MongoDB:', err);
    eloData = {};
  }
}

function set(userId, elo) {
  eloData[userId] = elo;
}

function get(userId) {
  return eloData[userId] ?? 0;
}

function getSortedEntries() {
  return Object.entries(eloData)
    .filter(([, elo]) => typeof elo === 'number')
    .sort(([, eloA], [, eloB]) => eloB - eloA);
}

module.exports = {
  refresh,
  get,
  set,
  getSortedEntries,
};
