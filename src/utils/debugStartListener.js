const { redis, redisSub } = require('./redisClient');
const Player = require('../models/Player');
const partySystem = require('./partySystem');
require('dotenv').config();

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

async function setupDebugStartListener(client) {
  const CHECK_CHANNEL = 'debug.start.check';
  
  console.log(`[DebugStartListener] Subscribing to ${CHECK_CHANNEL}...`);
  await redisSub.subscribe(CHECK_CHANNEL);

  redisSub.on('message', async (channel, message) => {
    if (channel !== CHECK_CHANNEL) return;

    try {
      const payload = JSON.parse(message);
      if (payload.action !== 'CHECK') return;

      const guildId = process.env.GUILD_ID;
      const vcId = process.env.DEBUG_START_VOICE_CHANNEL_ID;

      if (!guildId || !vcId) {
         console.warn('[DebugStartListener] GUILD_ID or DEBUG_START_VOICE_CHANNEL_ID missing in .env');
         return;
      }

      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      const voiceChannel = guild.channels.cache.get(vcId);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
         return;
      }

      const members = Array.from(voiceChannel.members.values());
      if (members.length === 0) {
         return; // No players
      }

      // Fetch player IGNs and check parties
      const playerData = await Promise.all(members.map(async (m) => {
         const p = await Player.load(m);
         const ign = p.ingameUsername || m.user.username;
         const party = await partySystem.getPartyByUser(m.id);
         return { id: m.id, ign, partyId: party ? party.leaderId : null };
      }));

      // Shuffle initially to randomize who goes where if conditions are equal
      shuffle(playerData);

      let team1 = [];
      let team2 = [];

      const count = playerData.length;

      if (count === 2) {
         // Split into 1v1 even if in party
         team1.push(playerData[0]);
         team2.push(playerData[1]);
      } else if (count === 3) {
         // Check if 2 are in party
         let partyGroup = null;
         for (let i = 0; i < playerData.length; i++) {
           const pId = playerData[i].partyId;
           if (pId) {
             const others = playerData.filter(p => p.partyId === pId);
             if (others.length === 2) {
               partyGroup = others;
               break;
             }
           }
         }

         if (partyGroup) {
           team1.push(partyGroup[0], partyGroup[1]);
           team2.push(playerData.find(p => p.partyId !== partyGroup[0].partyId));
         } else {
           // 3 players not in party, random 2v1
           team1.push(playerData[0], playerData[1]);
           team2.push(playerData[2]);
         }
      } else if (count === 4) {
         // Check if 2 are in party
         let partyGroup = null;
         for (let i = 0; i < playerData.length; i++) {
           const pId = playerData[i].partyId;
           if (pId) {
             const others = playerData.filter(p => p.partyId === pId);
             if (others.length === 2) {
               partyGroup = others;
               break;
             }
           }
         }

         if (partyGroup) {
           team1.push(partyGroup[0], partyGroup[1]);
           const remaining = playerData.filter(p => p.partyId !== partyGroup[0].partyId);
           team2.push(remaining[0], remaining[1]);
         } else {
           // If no party of 2, just 2v2 randomly (since already shuffled)
           team1.push(playerData[0], playerData[1]);
           team2.push(playerData[2], playerData[3]);
         }
      } else {
         // For anything else (1, 5+), split in half randomly
         for (let i = 0; i < count; i++) {
           if (i < count / 2) team1.push(playerData[i]);
           else team2.push(playerData[i]);
         }
      }

      // Convert to strings
      const team1Strings = team1.map(p => p.ign);
      const team2Strings = team2.map(p => p.ign);

      const responsePayload = {
        action: payload.action,
        requestId: payload.requestId,
        matchId: payload.matchId,
        admin: payload.admin,
        map: payload.map,
        team1: team1Strings,
        team2: team2Strings,
        timestamp: payload.timestamp || Date.now()
      };

      await redis.publish('debug.start.confirmed', JSON.stringify(responsePayload));
      console.log(`[DebugStartListener] Processed debug.start.check for match ${payload.matchId}`);

    } catch (err) {
      console.error('[DebugStartListener] Error processing message:', err);
    }
  });
}

module.exports = { setupDebugStartListener };
