const { createCanvas, loadImage, registerFont } = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getRankByElo } = require('./EloRank');
const { formatScoreStats } = require('./scoreStats');

try {
  registerFont(path.join(__dirname, '../../assets/PlusJakartaSans-Bold.ttf'), { family: 'PlusJakartaSans', weight: 'bold' });
} catch (e) {}

async function generateScoreImage(gameId, winningTeam, results, mvp, winBedbreaker, loseBedbreaker, mapName = null) {
  // Draw a wider table instead of stretching the old three-column template.
  const width = 1800;
  const rowHeight = 86;
  const winners = results.filter(p => p.result.includes('Win'));
  const losers = results.filter(p => p.result.includes('Loss'));
  const height = Math.max(750, 330 + (winners.length + losers.length) * rowHeight);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#172447';
  ctx.fillRect(0, 0, width, height);

  function text(value, x, y, size = 23, color = '#ffffff', align = 'left', maxWidth) {
    ctx.font = `bold ${size}px PlusJakartaSans, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (maxWidth) ctx.fillText(String(value), x, y, maxWidth);
    else ctx.fillText(String(value), x, y);
  }

  text('Lucky Ranked Bedwars • Match Results', 40, 38, 30);
  text(`Game ${gameId}${mapName ? ` | ${mapName}` : ''}`, 40, 78, 21, '#bdcae6', 'left', 1700);
  const columns = [
    ['PLAYER', 115], ['KILLS', 580], ['DEATHS', 685], ['K/D', 795],
    ['DIAMONDS', 930], ['EMERALDS', 1080], ['RANK', 1300], ['ELO CHANGE', 1595]
  ];
  ctx.fillStyle = '#293d70';
  ctx.fillRect(40, 110, 1720, 48);
  for (const [label, x] of columns) text(label, x, 134, 19, '#dbe6ff', label === 'PLAYER' ? 'left' : 'center');

  function contains(names, username) {
    return (Array.isArray(names) ? names : names ? [names] : [])
      .some(name => String(name).toLowerCase() === String(username).toLowerCase());
  }

  async function drawTeam(players, y, isWinner) {
    text(isWinner ? 'WINNING TEAM' : 'LOSING TEAM', 50, y + 18, 20, isWinner ? '#77e3b0' : '#ffb1bf');
    y += 40;
    for (const [index, player] of players.entries()) {
      ctx.fillStyle = isWinner ? (index % 2 ? '#204b49' : '#285654') : (index % 2 ? '#51324d' : '#603b58');
      ctx.fillRect(40, y, 1720, rowHeight - 3);
      const middle = y + rowHeight / 2;
      const username = player.username || player.nickname || player.name || 'Unknown';
      try {
        const avatar = await loadImage(`https://mc-heads.net/avatar/${encodeURIComponent(player.name || username)}/52`);
        ctx.drawImage(avatar, 55, y + 16, 52, 52);
      } catch (err) {
        ctx.fillStyle = '#53617d';
        ctx.fillRect(55, y + 16, 52, 52);
      }
      text(username, 120, middle - 10, 25, '#ffffff', 'left', 380);
      const badges = [];
      if (contains(mvp, username)) badges.push('MVP');
      if (contains(winBedbreaker, username) || contains(loseBedbreaker, username)) badges.push('BEDBREAKER');
      if (badges.length) text(badges.join(' • '), 120, middle + 20, 15, '#ffdc72', 'left', 380);

      const stats = formatScoreStats(player);
      for (const [key, x] of [['kills', 580], ['deaths', 685], ['kd', 795], ['diamonds', 930], ['emeralds', 1080]]) {
        text(stats[key], x, middle, 24, key === 'diamonds' ? '#78d8ff' : key === 'emeralds' ? '#77e3b0' : '#ffffff', 'center', 120);
      }
      const oldRank = getRankByElo(player.oldElo).name;
      const newRank = getRankByElo(player.newElo).name;
      if (oldRank === newRank) text(newRank, 1300, middle, 20, '#ffffff', 'center', 230);
      else {
        text(`${oldRank} →`, 1300, middle - 13, 18, '#bdcae6', 'center', 230);
        text(newRank, 1300, middle + 13, 20, '#ffffff', 'center', 230);
      }
      const change = player.newElo - player.oldElo;
      text(`${player.oldElo} → ${player.newElo}`, 1595, middle - 13, 23, '#ffffff', 'center', 280);
      text(`(${change >= 0 ? '+' : ''}${change})`, 1595, middle + 17, 21, change >= 0 ? '#77e3b0' : '#ff9bac', 'center');
      y += rowHeight;
    }
    return y;
  }

  let y = await drawTeam(winners, 170, true);
  y = await drawTeam(losers, y + 18, false);
  text('Match stats • N/A = not reported • With 0 deaths, K/D equals kills.', 40, Math.max(y + 24, height - 28), 17, '#bdcae6');
  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: `score-${gameId}.png` });
}

module.exports = { generateScoreImage };
