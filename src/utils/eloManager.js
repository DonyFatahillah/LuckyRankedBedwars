const fs = require('fs');
const path = require('path');
const PlayerModel = require('../models/PlayerSchema');
const eloCache = require('../cache/eloCache');

const DATA_DIR = path.join(__dirname, '../../data');
const ELO_PATH = path.join(DATA_DIR, 'elo.json');

let eloData = {};

function initializeEloFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(ELO_PATH)) {
    fs.writeFileSync(ELO_PATH, JSON.stringify({}), 'utf8');
  }

  try {
    const raw = fs.readFileSync(ELO_PATH, 'utf8');
    eloData = JSON.parse(raw);
  } catch (err) {
    console.error('[ELO] Failed to load elo.json. Resetting.', err);
    eloData = {};
    fs.writeFileSync(ELO_PATH, JSON.stringify(eloData, null, 2));
  }
}

function getElo(userId) {
  return eloData[userId] ?? 0;
}

async function setElo(userId, newElo) {
  // Update local cache and JSON
  eloData[userId] = newElo;
  saveEloData();
  eloCache.set(userId, newElo);

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

function saveEloData() {
  try {
    fs.writeFileSync(ELO_PATH, JSON.stringify(eloData, null, 2), 'utf8');
  } catch (err) {
    console.error('[ELO] Failed to save elo.json:', err);
  }
}

initializeEloFile();

module.exports = {
  getElo,
  setElo,
};
