const { createCanvas, loadImage, registerFont } = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const axios = require('axios');
const { getRankByElo } = require('./EloRank');

registerFont(path.join(__dirname, '../../assets/PlusJakartaSans-Bold.ttf'), {
  family: 'PlusJakartaLeaderboard', weight: 'bold'
});

const PODIUM_COLORS = ['#78D8FF', '#FFD966', '#FFBE98'];

// Entries are already sorted by ELO, as in the live leaderboard.
async function generateLeaderboardImage(entries, { startPosition = 1, title = 'ELO Leaderboard' } = {}) {
  const background = await loadImage(path.join(__dirname, '../../assets/leaderboard.png'));
  const canvas = createCanvas(1600, 900);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, 1600, 900);

  function write(value, x, y, size = 26, color = '#ffffff', maxWidth = 120, align = 'center') {
    ctx.font = `bold ${size}px PlusJakartaLeaderboard, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x, y, maxWidth);
  }

  write(title, 795, 65, 32, '#ffffff', 1375);
  const visibleEntries = entries.slice(0, 10);
  // Fetch visible heads concurrently, with a timeout so an unavailable skin
  // service cannot prevent the leaderboard from being sent.
  const heads = await Promise.all(visibleEntries.map(async entry => {
    const identity = entry.minecraftUuid || entry.username;
    if (!identity) return null;
    try {
      const response = await axios.get(`https://mc-heads.net/avatar/${encodeURIComponent(identity)}/40`, {
        responseType: 'arraybuffer', timeout: 5000
      });
      return await loadImage(response.data);
    } catch (err) {
      return null;
    }
  }));
  const ratio = (a, b) => a == null || b == null ? 'N/A' : (b === 0 ? a : a / b).toFixed(2);
  visibleEntries.forEach((entry, index) => {
    const position = startPosition + index;
    const color = PODIUM_COLORS[position - 1] || '#ffffff';
    const y = 145 + (index + 0.5) * 65;
    const wins = entry.wins ?? 0;
    const losses = entry.losses ?? 0;
    const elo = entry.elo ?? 0;
    write(`#${position}`, 150, y, 28, color, 75);
    if (heads[index]) {
      ctx.drawImage(heads[index], 247, y - 20, 40, 40);
    } else {
      ctx.fillStyle = '#53617d';
      ctx.fillRect(247, y - 20, 40, 40);
    }
    write(entry.username || 'Unknown', 300, y, 28, color, 397, 'left');
    write(elo, 785, y, 28, color);
    write(ratio(wins, losses), 943, y, 26, color);
    write(ratio(entry.kills, entry.deaths), 1095, y, 26, color);
    write(wins + losses, 1252, y, 26, color);
    write(getRankByElo(elo)?.name || 'Unknown', 1410, y, 23, color, 135);
  });
  if (!visibleEntries.length) write('No players found', 795, 470, 32, '#ffffff', 1200);

  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'leaderboard.png' });
}

module.exports = { generateLeaderboardImage };
