const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const MAP_YAML_PATH = path.join(__dirname, '../../data/mapList.yaml');

let mapList = [];

function loadMapList() {
  try {
    const raw = fs.readFileSync(MAP_YAML_PATH, 'utf8');
    const data = yaml.load(raw);
    mapList = Array.isArray(data.maps) ? data.maps : [];
    console.log(`[MapPicker] Loaded ${mapList.length} maps`);
  } catch (err) {
    console.error('[MapPicker] Failed to load map list:', err);
    mapList = [];
  }
}

function getRandomMap() {
  if (mapList.length === 0) return 'Unknown Map';
  return mapList[Math.floor(Math.random() * mapList.length)];
}

module.exports = {
  loadMapList,
  getRandomMap
};
