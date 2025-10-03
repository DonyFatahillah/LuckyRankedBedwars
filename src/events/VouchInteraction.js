const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');
require('dotenv').config();

const strikePath = path.join(__dirname, '../../data/strikes.json');
const matchLogPath = path.join(__dirname, '../../data/matchLogs.json');

function loadStrikes() {
  try {
    return JSON.parse(fs.readFileSync(strikePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStrikes(data) {
  fs.writeFileSync(strikePath, JSON.stringify(data, null, 2));
}

function loadMatchLogs() {
  try {
    return JSON.parse(fs.readFileSync(matchLogPath, 'utf-8'));
  } catch {
    return {};
  }
}

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    if (!interaction.isButton()) return;

    const [prefix, action, gameId, strikedId] = interaction.customId.split('-');
    if (prefix !== 'strike' || action !== 'vouch') return;

    const userId = interaction.user.id;

    // ❌ Prevent striked player from vouching
    if (userId === strikedId) {
      return await interaction.reply({
        content: '❌ You cannot vouch for your own strike.',
        ephemeral: true
      });
    }

    const strikes = loadStrikes();
    const logs = loadMatchLogs();
    const strike = strikes?.[gameId]?.[strikedId];

    if (!strike || !logs[gameId]) {
      return await interaction.reply({ content: '❌ Strike data not found.', ephemeral: true });
    }

    const team = strike.team;
    const validVouchers = logs[gameId][team];

    if (!validVouchers.includes(userId)) {
      return await interaction.reply({ content: '❌ You are not allowed to vouch for this strike.', ephemeral: true });
    }

    if (strike.vouches.includes(userId)) {
      return await interaction.reply({ content: '❌ You have already vouched.', ephemeral: true });
    }

    // ✅ Record vouch
    strike.vouches.push(userId);
    saveStrikes(strikes);

    // 📝 Send staff log
    const staffLog = await interaction.guild.channels.fetch(process.env.STRIKE_STAFF_CHANNEL_ID).catch(() => null);
    if (staffLog) {
      await staffLog.send({
        content: `📝 <@${userId}> vouched for strike on <@${strikedId}> in match #${gameId}.`,
      });
    }

    await interaction.reply({ content: '✅ Your vouch has been recorded.', ephemeral: true });
  }
};
