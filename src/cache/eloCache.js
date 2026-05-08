const fs = require('fs');
const path = require('path');

const ELO_PATH = path.join(__dirname, '../../data/elo.json');
let eloData = {};

// ─────────────────────────────────────────────
// Refresh from disk
function refresh() {
  try {
    const raw = fs.readFileSync(ELO_PATH, 'utf-8');
    eloData = JSON.parse(raw);
    console.log(`[ELO Cache] Loaded ${Object.keys(eloData).length} player entries`);
  } catch (err) {
    console.error('[ELO Cache] Failed to load elo.json:', err);
    eloData = {};
  }
}

// ─────────────────────────────────────────────
// Set or update individual user ELO in cache
function set(userId, elo) {
  eloData[userId] = elo;
}

// ─────────────────────────────────────────────
// Get ELO
function get(userId) {
  return eloData[userId] ?? 0;
}

// ─────────────────────────────────────────────
// Sorted leaderboard logic
function getSortedEntries() {
  return Object.entries(eloData)
    .filter(([, elo]) => typeof elo === 'number')
    .sort(([, eloA], [, eloB]) => eloB - eloA);
}

function getEloPage(page = 0, size = 10) {
  const sorted = getSortedEntries();
  return sorted.slice(page * size, (page + 1) * size);
}

function getTotalPages(size = 10) {
  return Math.ceil(getSortedEntries().length / size);
}

module.exports = {
  refresh,
  get,
  set, // ✅ now export it
  getEloPage,
  getTotalPages,
  getSortedEntries,
};
