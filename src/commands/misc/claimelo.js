const { SlashCommandBuilder } = require('discord.js');
const Player = require('../../models/Player');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CLAIMED_PATH = path.join(__dirname, '../../../data/claimedElo.json');

function loadClaimed() {
  if (fs.existsSync(CLAIMED_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CLAIMED_PATH, 'utf-8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveClaimed(data) {
  fs.writeFileSync(CLAIMED_PATH, JSON.stringify(data, null, 2));
}

const NITRO = process.env.NITRO_ROLE_ID;
const STAFF = process.env.STAFF_ROLE_ID;
const ROLE1 = process.env.CHAMPIONS_ROLE_ID;
const ROLE2 = process.env.MEDIA_ROLE_ID;
const ROLE3 = process.env.PROS_ROLE_ID;
const PREMIUM = process.env.PREMIUM_ROLE_ID;
const PUGS = process.env.PUGS_ROLE_ID;
const PUPS = process.env.PUPS_ROLE_ID;
const PITS = process.env.PITS_ROLE_ID;
const LUCKYSTAFF = process.env.LUCKYSTAFF_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claimelo')
    .setDescription('🎁 Claim your initial ELO based on your role (only once)'),

  async execute(interaction) {
    const member = interaction.member;
    const userId = member.id;

    const claimed = loadClaimed();

    if (claimed[userId]) {
      return interaction.reply({ content: '❌ You already claimed your ELO.', ephemeral: true });
    }

    const player = await Player.load(member);

    if (player.elo !== 0) {
      return interaction.reply({ content: `❌ You can only claim if your ELO is **0** (Current: **${player.elo}**).`, ephemeral: true });
    }

    const roles = member.roles.cache;
    let claimAmount = 0;

    // ✅ Priority-based claim (highest eligible role wins)
    if (roles.has(ROLE2) || roles.has(ROLE3)) claimAmount = Math.max(claimAmount, 250);
    if (roles.has(NITRO) || roles.has(PREMIUM)) claimAmount = Math.max(claimAmount, 200);
    if (roles.has(PUGS)) claimAmount = Math.max(claimAmount, 150);
    if (roles.has(STAFF) || roles.has(ROLE1) || roles.has(PUPS) || roles.has(LUCKYSTAFF)) claimAmount = Math.max(claimAmount, 100);
    if (roles.has(PITS)) claimAmount = Math.max(claimAmount, 50);

    if (claimAmount === 0) {
      return interaction.reply({
        content: '❌ You do not have any roles eligible to claim ELO.',
        ephemeral: true
      });
    }

    // ✅ Grant ELO
    await player.setElo(claimAmount);
    claimed[userId] = {
      claimedAt: new Date().toISOString(),
      amount: claimAmount
    };
    saveClaimed(claimed);

    return interaction.reply({
      content: `✅ You have claimed **${claimAmount} ELO**!`,
      ephemeral: true
    });
  }
};
