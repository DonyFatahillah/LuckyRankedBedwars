const { createCanvas, loadImage, registerFont } = require('canvas');

try {
  registerFont(require('path').join(__dirname, '../../assets/PlusJakartaSans-Bold.ttf'), { family: 'PlusJakartaSans', weight: 'bold' });
} catch (e) {}

const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getRankByElo } = require('./EloRank');

async function generateScoreImage(gameId, winningTeam, results, mvp, winBedbreaker, loseBedbreaker, mapName = null) {
  let bg;
  let width = 800;
  let height = 600;
  
  try {
    bg = await loadImage(path.join(__dirname, '../../assets/scoring_canvas.png'));
    width = bg.width;
    height = bg.height;
  } catch (err) {}

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  if (bg) {
    ctx.drawImage(bg, 0, 0, width, height);
  } else {
    // Fallback if image is missing
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, width, height);
  }

  // Split into winners and losers
  const winners = results.filter(p => p.result.includes('Win'));
  const losers = results.filter(p => p.result.includes('Loss'));

  // Load MVP & Bedbreaker logos beforehand
  let mvpLogo, bedLogo;
  try { mvpLogo = await loadImage(path.join(__dirname, '../../assets/mvp_logo.png')); } catch (e) {}
  try { bedLogo = await loadImage(path.join(__dirname, '../../assets/bed_logo.png')); } catch (e) {}

  // Helper to draw a team block (fixed start to align with stripes)
  async function drawTeam(players, startY, isWinner) {
    const rowHeight = 84.5; 
    let currentY = startY;

    for (const player of players) {
      // 1. Draw Avatar (fetching from mc-heads.net)
      const avatarX = 265;
      const avatarSize = 56;
      const avatarYOffset = (rowHeight - avatarSize) / 2;
      try {
        const avatar = await loadImage(`https://mc-heads.net/avatar/${player.name}/${avatarSize}`);
        ctx.drawImage(avatar, avatarX, currentY + avatarYOffset, avatarSize, avatarSize);
      } catch (err) {
        ctx.fillStyle = '#555555';
        ctx.fillRect(avatarX, currentY + avatarYOffset, avatarSize, avatarSize);
      }

      // 2. Draw Name
      ctx.font = 'bold 29px PlusJakartaSans, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const nameX = 340;
      const nameY = currentY + (rowHeight / 2);
      ctx.fillText(player.nickname, nameX, nameY);

      // 3. Draw MVP/Bedbreaker pills if applicable
      let pillX = nameX + ctx.measureText(player.nickname).width + 30; // Increased spacing

      const logoHeight = 95; // Increased by 10px

      // Check if they are MVP
      if (mvp && mvp.includes(player.nickname)) {
        if (mvpLogo) {
          const scaledWidth = mvpLogo.width * (logoHeight / mvpLogo.height);
          ctx.drawImage(mvpLogo, pillX, nameY - (logoHeight / 2), scaledWidth, logoHeight);
          pillX += scaledWidth + 10;
        } else {
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 13px PlusJakartaSans, sans-serif';
          ctx.fillText('⭐ MVP', pillX, nameY);
          pillX += 75;
        }
      }
      
      // Check if they are Bedbreaker
      if ((winBedbreaker && winBedbreaker.includes(player.nickname)) || (loseBedbreaker && loseBedbreaker.includes(player.nickname))) {
        if (bedLogo) {
          const scaledWidth = bedLogo.width * (logoHeight / bedLogo.height);
          ctx.drawImage(bedLogo, pillX, nameY - (logoHeight / 2), scaledWidth, logoHeight);
          pillX += scaledWidth + 10;
        }
      }

      // 4. Draw ELO Change
      const eloChange = player.newElo - player.oldElo;
      const changeText = isWinner ? `(+${eloChange})` : `(${eloChange})`;
      
      const oldRank = getRankByElo(player.oldElo).name;
      const newRank = getRankByElo(player.newElo).name;
      const rankText = (oldRank !== newRank) ? `${oldRank} ➝ ${newRank}` : newRank;
      
      ctx.font = 'bold 30px PlusJakartaSans, sans-serif';
      ctx.textAlign = 'center';
      
      // X coordinates for the two columns (centered exactly under the headers)
      const rankX = 916; 
      const eloX = 1184;
      
      // Draw Rank Name in the Rank column
      ctx.font = 'bold 20px PlusJakartaSans, sans-serif'; // Decreased by 10px
      ctx.fillStyle = '#ffffff';
      ctx.fillText(rankText, rankX, nameY);

      // Draw Elo numbers in the Elo Change column
      ctx.font = 'bold 25px PlusJakartaSans, sans-serif'; // Restore original size for Elo
      if (isWinner) {
        ctx.fillStyle = '#ffffff';
        const changeWidth = ctx.measureText(` ${changeText}`).width;
        ctx.fillText(`${player.oldElo} ➝ ${player.newElo}`, eloX - (changeWidth/2), nameY);
        ctx.fillStyle = '#55ff55';
        ctx.fillText(` ${changeText}`, eloX + (ctx.measureText(`${player.oldElo} ➝ ${player.newElo}`).width / 2), nameY);
      } else {
        ctx.fillStyle = '#ffffff';
        const changeWidth = ctx.measureText(` ${changeText}`).width;
        ctx.fillText(`${player.oldElo} ➝ ${player.newElo}`, eloX - (changeWidth/2), nameY);
        ctx.fillStyle = '#ff5555';
        ctx.fillText(` ${changeText}`, eloX + (ctx.measureText(`${player.oldElo} ➝ ${player.newElo}`).width / 2), nameY);
      }

      currentY += rowHeight;
    }
  }

  // Fixed Y-coordinates to perfectly align with the topmost stripes of the boxes
  await drawTeam(winners, 105, true);
  await drawTeam(losers, 477, false);

  // Top left text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px PlusJakartaSans, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const titleText = mapName ? `Game ${gameId} | ${mapName}` : `Game ${gameId}`;
  ctx.fillText(titleText, 50, 30);

  // Convert to discord attachment
  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: `score-${gameId}.png` });
}

module.exports = { generateScoreImage };
