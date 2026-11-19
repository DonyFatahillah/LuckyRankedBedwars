const { createCanvas, loadImage, registerFont } = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');
const { getRankByElo } = require('./EloRank');

registerFont(path.join(__dirname, '../../assets/PlusJakartaSans-Bold.ttf'), { family: 'PlusJakartaProfile', weight: 'bold' });

async function generateProfileImage(username, stats = {}) {
  const [background, skin] = await Promise.all([
    loadImage(path.join(__dirname, '../../assets/profile_canvas.png')),
    axios.get(`https://mc-heads.net/body/${encodeURIComponent(username)}/300`, {
      responseType: 'arraybuffer', timeout: 10000
    }).then(response => loadImage(response.data)).catch(() => null)
  ]);
  const canvas = createCanvas(1600, 900);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, 1600, 900);

  const write = (value, x, y, size = 42, maxWidth = 160, align = 'center') => {
    ctx.font = `bold ${size}px PlusJakartaProfile, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x, y, maxWidth);
  };

  const wins = stats.wins ?? 0;
  const losses = stats.losses ?? 0;
  const kills = stats.kills ?? 0;
  const deaths = stats.deaths ?? 0;
  const elo = stats.elo ?? 0;
  const ratio = (a, b) => (b === 0 ? a : a / b).toFixed(2);

  write(username, 365, 76, 32, 510);
  write(getRankByElo(elo).name, 285, 153, 30, 315, 'left');
  write(elo, 265, 214, 30, 335, 'left');
  if (skin) {
    // Preserve the body render's aspect ratio within the left panel.
    const scale = Math.min(360 / skin.width, 500 / skin.height);
    const width = skin.width * scale;
    const height = skin.height * scale;
    ctx.drawImage(skin, 365 - width / 2, 275 + (500 - height) / 2, width, height);
  } else {
    write('Skin unavailable', 365, 520, 25, 400);
  }

  for (const [value, x] of [[wins, 740], [losses, 940], [kills, 1135], [deaths, 1330]]) {
    write(value, x, 185);
  }
  for (const [value, x] of [[ratio(wins, losses), 740], [ratio(kills, deaths), 940],
    [stats.bedsBroken ?? 0, 1135], [stats.topKills ?? stats.mvps ?? 0, 1330]]) {
    write(value, x, 382);
  }
  write(stats.winstreak ?? 0, 1270, 565, 44, 150);
  write(wins + losses, 1270, 749, 44, 150);

  const recentGames = Array.isArray(stats.recentlyPlayed) ? stats.recentlyPlayed.slice(0, 5) : [];
  if (recentGames.length) {
    recentGames.forEach((game, i) => write(`Game #${game}`, 670, 545 + i * 51, 26, 470, 'left'));
  } else {
    write('No recent games', 906, 657, 28, 470);
  }

  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile-debug.png' });
}

module.exports = { generateProfileImage };
