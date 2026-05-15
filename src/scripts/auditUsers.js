require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const PlayerModel = require('../models/PlayerSchema');
const { getPlayerCache } = require('../utils/redisClient');

// Define IDs for roles to be removed
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || '1401289452633985086';
const RANK_ROLE_IDS = [
  '1401289525023608933', // IRON
  '1401289578832461966', // BRONZE
  '1401289612252545095', // SILVER
  '1401289645064720435', // GOLD
  '1401289670612221982', // PLATINUM
  '1401289724143996948', // DIAMOND
  '1401289700840312902', // EMERALD
  '1401289774676836522', // CRYSTAL
  '1401289846953214042', // QUARTZ
  '1422195619019096085', // SAPPHIRE
  '1422195910452051988', // AMETHYST
  '1422195934267314300', // JADE
  '1422195938843168858', // OBSIDIAN
  '1422798147159068673', // ONYX
  '1422798499019489391', // AGATE
  '1422798660617506927', // ADAMITE
  '1423108965440684086', // PRISM
  '1423109196659818507', // AMBER
  '1423109579612618863', // AZURITE
  '1423109719517691947', // ELITE
  '1423109910291419257'  // CELESTIAL
];

async function auditUsers() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'RankedBedwars' });
    console.log('🚀 Connected to MongoDB');

    await client.login(process.env.DISCORD_TOKEN);
    console.log('🤖 Logged into Discord');

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const members = await guild.members.fetch();

    console.log(`📊 Auditing ${members.size} members...`);

    for (const [memberId, member] of members) {
      // Skip bots
      if (member.user.bot) continue;

      // Check if user is linked in bot data
      const cached = await getPlayerCache(memberId);
      const dbEntry = await PlayerModel.findOne({ userId: memberId });

      if (!cached && !dbEntry) {
        // User is not found, check if they have restricted roles
        const hasVerifiedRole = member.roles.cache.has(VERIFIED_ROLE_ID);
        const hasRankRole = member.roles.cache.some(role => RANK_ROLE_IDS.includes(role.id));

        if (hasVerifiedRole || hasRankRole) {
          console.log(`🧹 Found invalid user: ${member.user.username} (${memberId}). Cleaning up...`);
          
          try {
            // Remove roles
            if (hasVerifiedRole) await member.roles.remove(VERIFIED_ROLE_ID);
            for (const rankId of RANK_ROLE_IDS) {
              if (member.roles.cache.has(rankId)) await member.roles.remove(rankId);
            }

            // Reset nickname
            await member.setNickname(member.user.username);
            console.log(`✅ Roles removed and nickname reset for ${member.user.username}`);
          } catch (err) {
            console.error(`❌ Failed to clean up ${member.user.username}:`, err.message);
          }
        }
      }
    }

    console.log('🎉 Audit complete.');
  } catch (err) {
    console.error('❌ Audit failed:', err);
  } finally {
    client.destroy();
  }
}

auditUsers();
