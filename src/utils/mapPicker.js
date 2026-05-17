const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const MAP_YAML_PATH = path.join(__dirname, '../../data/mapList.yaml');

let mapList = [];
let mapStats = {};

function loadMapList() {
  try {
    const raw = fs.readFileSync(MAP_YAML_PATH, 'utf8');
    const data = yaml.load(raw) || { maps: [] };
    mapList = Array.isArray(data.maps) ? data.maps : [];
    mapStats = data.stats || {};
    
    // Ensure all maps are in stats
    mapList.forEach(m => {
      if (!mapStats[m]) mapStats[m] = { picked: 0, total: 0 };
    });
    
    saveStats();
    console.log(`[MapPicker] Loaded ${mapList.length} maps`);
  } catch (err) {
    console.error('[MapPicker] Failed to load map list:', err);
    mapList = [];
  }
}

function saveStats() {
  const data = { maps: mapList, stats: mapStats };
  fs.writeFileSync(MAP_YAML_PATH, yaml.dump(data));
}

function getRandomMap() {
  if (mapList.length === 0) return 'Unknown Map';

  const totalGames = Object.values(mapStats).reduce((sum, s) => sum + s.total, 0) + 1;
  
  const weightedMaps = mapList.map(map => {
    const stats = mapStats[map] || { picked: 0, total: 0 };
    const pickRate = stats.picked / totalGames;
    // If pick rate >= 50%, reduce weight to 0.01 (1%)
    const weight = pickRate >= 0.5 ? 0.01 : 1.0;
    return { map, weight };
  });

  const totalWeight = weightedMaps.reduce((sum, m) => sum + m.weight, 0);
  let random = Math.random() * totalWeight;
  
  let selected = weightedMaps[0].map;
  for (const item of weightedMaps) {
    random -= item.weight;
    if (random <= 0) {
      selected = item.map;
      break;
    }
  }

  // Update stats
  mapList.forEach(m => {
    if (!mapStats[m]) mapStats[m] = { picked: 0, total: 0 };
    mapStats[m].total++;
    if (m === selected) mapStats[m].picked++;
  });
  saveStats();

  return selected;
}

function getRandomMaps(count = 3) {
  if (mapList.length === 0) return ['Unknown Map'];
  const shuffled = [...mapList].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, mapList.length));
}

module.exports = {
  loadMapList,
  getRandomMap,
  getRandomMaps
};
