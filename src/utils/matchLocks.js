// src/utils/matchLocks.js
const activeLocks = new Set();

function isLocked(gameId) {
  return activeLocks.has(gameId);
}

function lock(gameId) {
  activeLocks.add(gameId);
}

function unlock(gameId) {
  activeLocks.delete(gameId);
}

module.exports = { isLocked, lock, unlock };
