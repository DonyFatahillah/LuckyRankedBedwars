const { createCanvas, loadImage, registerFont } = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getRankByElo } = require('./EloRank');
const { formatScoreStats } = require('./scoreStats');

try {
  registerFont(path.join(__dirname, '../../assets/PlusJakartaSans-Bold.ttf'), { family: 'PlusJakartaSans', weight: 'bold' });
} catch (e) {}

async function generateScoreImage(gameId, winningTeam, results, mvp, winBedbreaker, loseBedbreaker, mapName = null) {
  const width = 1600;
  const height = 900;
  const rowHeight = 84;
  const winners = results.filter(p => p.result.includes('Win'));
  const losers = results.filter(p => p.result.includes('Loss'));
  const [background, mvpBadge, bedBadge] = await Promise.all([
    loadImage(path.join(__dirname, '../../assets/scoring_canvas.png')),
    loadImage(path.join(__dirname, '../../assets/mvp_logo.png')),
    loadImage(path.join(__dirname, '../../assets/bed_logo.png'))
  ]);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, width, height);

  function text(value, x, y, size = 23, color = '#ffffff', align = 'left', maxWidth) {
    ctx.font = `bold ${size}px PlusJakartaSans, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (maxWidth) ctx.fillText(String(value), x, y, maxWidth);
    else ctx.fillText(String(value), x, y);
  }

  text(`Game ${gameId}${mapName ? ` | ${mapName}` : ''}`, 107, 28, 19, '#ffffff', 'left', 1375);

  function contains(names, username) {
    return (Array.isArray(names) ? names : names ? String(names).split(',') : [])
      .some(name => String(name).trim().toLowerCase() === String(username).toLowerCase());
  }

  async function drawTeam(players, panelTop) {
    // Use the template's fixed rows for every team size. Panel-centering small
    // teams puts odd-sized rosters on stripe boundaries instead of row centers.
    for (const [index, player] of players.entries()) {
      const y = panelTop + index * rowHeight;
      const middle = y + rowHeight / 2;
      const username = player.username || player.nickname || player.name || 'Unknown';
      try {
        const avatar = await loadImage(`https://mc-heads.net/avatar/${encodeURIComponent(player.name || username)}/52`);
        ctx.drawImage(avatar, 123, middle - 26, 52, 52);
      } catch (err) {
        ctx.fillStyle = '#53617d';
        ctx.fillRect(123, middle - 26, 52, 52);
      }
      const badges = [];
      if (contains(mvp, username)) badges.push(mvpBadge);
      if (contains(winBedbreaker, username) || contains(loseBedbreaker, username)) badges.push(bedBadge);
      const badgeWidth = 75;
      const badgeHeight = 25;
      const badgeGap = 6;
      const nameWidth = 310 - badges.length * (badgeWidth + badgeGap);
      text(username, 190, middle, 24, '#ffffff', 'left', nameWidth);
      const renderedNameWidth = Math.min(ctx.measureText(username).width, nameWidth);
      let badgeX = 190 + renderedNameWidth + badgeGap;
      for (const badge of badges) {
        // Both 1080px assets include transparent padding around the pill.
        // Crop to the visible badge so its height matches the player name.
        ctx.drawImage(badge, 33, 371, 1014, 338, badgeX, middle - badgeHeight / 2, badgeWidth, badgeHeight);
        badgeX += badgeWidth + badgeGap;
      }

      const stats = formatScoreStats(player);
      for (const [key, x] of [['kills', 548], ['deaths', 664], ['kd', 780], ['diamonds', 876], ['emeralds', 958]]) {
        text(stats[key], x, middle, 24, key === 'diamonds' ? '#78d8ff' : key === 'emeralds' ? '#77e3b0' : '#ffffff', 'center', 76);
      }
      const oldRank = getRankByElo(player.oldElo).name;
      const newRank = getRankByElo(player.newElo).name;
      if (oldRank === newRank) text(newRank, 1110, middle, 20, '#ffffff', 'center', 195);
      else {
        text(`${oldRank} →`, 1110, middle - 13, 18, '#dbe6ff', 'center', 195);
        text(newRank, 1110, middle + 13, 20, '#ffffff', 'center', 195);
      }
      const change = player.newElo - player.oldElo;
      text(`${player.oldElo} → ${player.newElo}`, 1350, middle - 13, 23, '#ffffff', 'center', 240);
      text(`(${change >= 0 ? '+' : ''}${change})`, 1350, middle + 17, 21, change >= 0 ? '#77e3b0' : '#ff9bac', 'center');
    }
  }

  await drawTeam(winners, 95);
  await drawTeam(losers, 502);
  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: `score-${gameId}.png` });
}

module.exports = { generateScoreImage };
