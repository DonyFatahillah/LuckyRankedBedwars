// src/queue/queueManager.js
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
require('dotenv').config({ path: path.join(__dirname, '/../.env') });
const mapPicker = require('../utils/mapPicker');
const ActiveGameModel = require('../models/ActiveGameSchema');

const ACTIVE_GAMES_PATH = path.join(__dirname, '../../data/activeGames.json');
const RULES_YAML_PATH = path.join(__dirname, '../../data/queueRules.yaml');

let _activeGames = new Map();
let _queueRules = {};
const queueLocks = new Map();
const playerLocks = new Set();

try {
  const raw = fs.readFileSync(RULES_YAML_PATH, 'utf8');
  _queueRules = yaml.load(raw);
} catch (err) {
  console.warn('[QueueRules] Failed to load YAML rules:', err.message);
}

const { logMatch, sendLogToStaffChannel } = require('../utils/matchLogger');
const Player = require('../models/Player');
const partySystem = require('../utils/partySystem');
const { publishMatch, getPlayerOnlineStatus, publishMatchVoid } = require('../utils/redisClient');
const { trackJoin, getJoinTime } = require('../utils/voiceJoinTracker');

// 🧠 Startup queue check
async function checkAllQueueChannelsOnStartup(client) {
  const eloQueues = require('../config/eloQueues');
  const guildId = process.env.GUILD_ID;
  if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const allChannels = await guild.channels.fetch();

  await Promise.all(eloQueues.map(async (queue) => {
    const { voiceChannelId, type } = queue;
    if (!voiceChannelId || !type) return;

    const voiceChannel = allChannels.get(voiceChannelId);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

    const members = [...voiceChannel.members.values()];
    if (members.length === 0) return;

    // Track join time for players already in VC
    members.forEach(member => trackJoin(member.id));

    console.log(`[StartupQueue] Found ${members.length} in queue ${type} → ${voiceChannel.name}`);

    try {
      const handlerPath = `./queue${type}`;
      const queueHandler = require(handlerPath);
      if (typeof queueHandler.handleQueue === 'function') {
        await queueHandler.handleQueue(guild, members);
      } else {
        console.warn(`[StartupQueue] Missing handleQueue() in ${handlerPath}`);
      }
    } catch (err) {
      console.error(`[StartupQueue] Failed to handle queue type ${type}:`, err);
    }
  }));
}

function generateHexCode() {
  let hex;
  do {
    hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
  } while (_activeGames.has(hex));
  return hex;
}

async function getEligibleGroups(members, targetCount, maxTeamSize = 4) {
  const soloMembers = [];
  const partyGroups = [];
  const memberMap = new Map(members.map(m => [m.id, m]));
  const processedParties = new Set();

  // --- Filter out players without a linked IGN OR who are not online ---
  const playerInstances = await Promise.all(members.map(m => Player.load(m)));
  const memberToPlayer = new Map(playerInstances.map(p => [p.id, p]));
  
  const onlineStatuses = await Promise.all(members.map(m => getPlayerOnlineStatus(m.id)));
  const memberToOnline = new Map(members.map((m, i) => [m.id, onlineStatuses[i]?.status === 'online']));

  const validMembers = members.filter(member => {
    const player = memberToPlayer.get(member.id);
    const isOnline = memberToOnline.get(member.id);
    return player && player.ingameUsername && player.ingameUsername.trim() !== "" && isOnline;
  });

  for (const member of validMembers) {
    const party = partySystem.getPartyByUser(member.id);

    if (party && !processedParties.has(party.leaderId)) {
      const presentMembers = party.members
        .map(id => memberMap.get(id))
        .filter(m => m && validMembers.some(vm => vm.id === m.id));

      // 🚨 CRITICAL: Check if ALL party members are present AND have a linked IGN AND are online
      if (presentMembers.length < party.members.length) {
        console.log(`[QueueSelection] Skipping party led by ${party.leaderId} - Only ${presentMembers.length}/${party.members.length} members present, linked, and online.`);
        processedParties.add(party.leaderId);
        continue;
      }
      
      const groupJoinTime = Math.min(...presentMembers.map(m => getJoinTime(m.id)));
      
      if (presentMembers.length > maxTeamSize) {
        for (let i = 0; i < presentMembers.length; i += maxTeamSize) {
          const slice = presentMembers.slice(i, i + maxTeamSize);
          partyGroups.push({ 
            members: slice, 
            joinTime: groupJoinTime,
            isParty: true
          });
        }
      } else {
        partyGroups.push({ 
          members: presentMembers, 
          joinTime: groupJoinTime, 
          isParty: true 
        });
      }

      processedParties.add(party.leaderId);

    } else if (!party) {
      soloMembers.push({ 
        member, 
        joinTime: getJoinTime(member.id),
        isParty: false
      });
    }
  }

  partyGroups.sort((a, b) => a.joinTime - b.joinTime);
  soloMembers.sort((a, b) => a.joinTime - b.joinTime);

  const selectedGroups = [];
  let total = 0;

  for (const group of partyGroups) {
    if (total + group.members.length <= targetCount) {
      selectedGroups.push(group);
      total += group.members.length;
    }
    if (total === targetCount) break;
  }

  if (total < targetCount) {
    for (const solo of soloMembers) {
      if (total < targetCount) {
        selectedGroups.push({
          members: [solo.member],
          joinTime: solo.joinTime,
          isParty: false
        });
        total++;
      } else {
        break;
      }
    }
  }

  return selectedGroups;
}

async function getEligiblePlayers(members, targetCount, maxTeamSize = 4) {
  const groups = await getEligibleGroups(members, targetCount, maxTeamSize);
  return groups.flatMap(g => g.members);
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

// -------------------------
// Match creation
// -------------------------
async function createMatch(guild, players, teamSize, options = {}) {
  if (!players || players.length === 0) return;

  const totalRequired = teamSize * 2;
  const eligibleGroups = await getEligibleGroups(players, totalRequired, teamSize);
  
  let totalSelected = 0;
  eligibleGroups.forEach(g => totalSelected += g.members.length);
  if (totalSelected < totalRequired) return;

  // --- Double-Trigger Safeguard ---
  const allCandidateIds = eligibleGroups.flatMap(g => g.members.map(m => m.id));
  if (allCandidateIds.some(id => playerLocks.has(id))) {
    console.warn(`[createMatch] Skipping match creation: One or more players are already being processed.`);
    return;
  }
  
  // Lock all players
  allCandidateIds.forEach(id => playerLocks.add(id));

  const hex = generateHexCode();
  const eloQueue = options.eloQueue;
  const isHighTier = eloQueue && eloQueue.minElo >= 600;

  const team1 = [];
  const team2 = [];

  const shuffledGroups = shuffle([...eligibleGroups]);

  for (const group of shuffledGroups) {
    if (team1.length + group.members.length <= teamSize) {
      team1.push(...group.members);
    } else if (team2.length + group.members.length <= teamSize) {
      team2.push(...group.members);
    } else {
      for (const member of group.members) {
        if (team1.length < teamSize) team1.push(member);
        else team2.push(member);
      }
    }
  }

  const teams = [team1, team2];
  const allSelectedPlayers = [...team1, ...team2];

  const captains = await Promise.all(
    teams.map(async team => {
      const instances = await Promise.all(team.map(m => Player.load(m)));
      return instances.reduce((top, p) => (p.elo > top.elo ? p : top), instances[0]).member.id;
    })
  );

  const rules = getRulesForMatchType(teamSize);

  try {
    const categoryPerms = getPermissionOverwrites(allSelectedPlayers, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory
    ], true);

    const category = await guild.channels.create({
      name: `#${hex} Game`,
      type: ChannelType.GuildCategory,
      permissionOverwrites: categoryPerms
    });

    // Create Text Channel and Team VCs in parallel
    const channelTasks = [
      guild.channels.create({
        name: `${hex}-chat`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: categoryPerms
      })
    ];

    if (!isHighTier) {
      for (let i = 0; i < teams.length; i++) {
        channelTasks.push(guild.channels.create({
          name: `#${hex} Team ${i + 1}`,
          type: ChannelType.GuildVoice,
          parent: category.id,
          permissionOverwrites: getPermissionOverwrites(teams[i], PermissionFlagsBits.Connect, false)
        }));
      }
    }

    const createdChannels = await Promise.all(channelTasks);
    const textChannel = createdChannels[0];
    const vcs = !isHighTier ? createdChannels.slice(1).map(c => c.id) : [];

    let selectedMap;

    if (isHighTier) {
      // 1. Create Waiting Room VC
      const waitingRoom = await guild.channels.create({
        name: `🕒 Waiting Room #${hex}`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: getPermissionOverwrites(allSelectedPlayers, PermissionFlagsBits.Connect, false)
      });

      // 2. Move players to Waiting Room (Parallel)
      await Promise.all(allSelectedPlayers.map(async p => {
        if (p.voice?.channelId) {
          return p.voice.setChannel(waitingRoom).catch(() => {});
        } else {
          // Fallback fetch if voice state is missing for some reason
          const member = await guild.members.fetch(p.id).catch(() => null);
          if (member?.voice.channelId) return member.voice.setChannel(waitingRoom).catch(() => {});
        }
      }));

      // 3. Map Voting
      const maps = mapPicker.getRandomMaps(3);
      const mapEmojis = ['1️⃣', '2️⃣', '3️⃣'];

      const voteEmbed = {
        title: "🗺️ Map Selection",
        description: "React with the corresponding number to vote for a map! You have 20 seconds.",
        fields: maps.map((m, i) => ({ name: `Option ${i + 1}`, value: `${mapEmojis[i]} **${m}**`, inline: true })),
        color: 0x0099ff
      };

      const voteMessage = await textChannel.send({
        content: allSelectedPlayers.map(p => `<@${p.id}>`).join(' '),
        embeds: [voteEmbed]
      });

      // Add reactions
      for (const emoji of mapEmojis) {
        await voteMessage.react(emoji).catch(() => {});
      }

      const votes = new Array(maps.length).fill(0);
      const voterIds = new Set();

      const filter = (reaction, user) => {
        return mapEmojis.includes(reaction.emoji.name) && allSelectedPlayers.some(p => p.id === user.id);
      };

      const collector = voteMessage.createReactionCollector({
        filter,
        time: 20000,
        dispose: true
      });

      collector.on('collect', (reaction, user) => {
        if (voterIds.has(user.id)) return; 
        voterIds.add(user.id);
      });

      await new Promise(resolve => collector.on('end', async (collected) => {
        // Tally votes from collected reactions
        mapEmojis.forEach((emoji, index) => {
          const reaction = collected.get(emoji);
          if (reaction) {
            votes[index] = Math.max(0, reaction.count - 1);
          }
        });
        resolve();
      }));

      const maxVotes = Math.max(...votes);
      const winners = maps.filter((_, index) => votes[index] === maxVotes);
      selectedMap = winners[Math.floor(Math.random() * winners.length)];

      await voteMessage.edit({
        content: `✅ **Selected Map:** ${selectedMap}`,
        embeds: []
      });
      await voteMessage.reactions.removeAll().catch(() => {});

      // --- SETUP PICKING PHASE ---
      const unpicked = allSelectedPlayers
        .map(p => p.id)
        .filter(id => !captains.includes(id));

      const matchData = {
        gameId: hex,
        players: allSelectedPlayers.map(p => p.id),
        teamA: [captains[0]],
        teamB: [captains[1]],
        captainIds: captains,
        categoryId: category.id,
        textChannelId: textChannel.id,
        voiceAId: null, // To be created after picking
        voiceBId: null, // To be created after picking
        queueType: `${teamSize}v${teamSize}`,
        map: selectedMap,
        startedAt: Date.now(),
        status: 'picking',
        pickingPhase: true,
        pickingTurn: captains[0], // Team 1 captain starts
        unpickedPlayers: unpicked,
        rules,
        isPartyMatch: options.isPartyMatch || false
      };

      await setActiveGame(hex, matchData);

      const pickingEmbed = {
        title: "🎮 Picking Phase Started",
        description: `Captain <@${captains[0]}>, it's your turn to pick a player!\nUse \`/pick <player>\` to choose from the pool.`,
        fields: [
          { name: "Pool", value: unpicked.map(id => `<@${id}>`).join('\n') || "None", inline: true },
          { name: "Team 1", value: `<@${captains[0]}>`, inline: true },
          { name: "Team 2", value: `<@${captains[1]}>`, inline: true }
        ],
        color: 0xffff00
      };

      await textChannel.send({ embeds: [pickingEmbed] });

    } else {
      // Normal flow
      selectedMap = mapPicker.getRandomMap();
      const teamVCs = createdChannels.slice(1);
      await movePlayersToVoiceChannels(guild, teams, teamVCs);

      const matchData = {
        gameId: hex,
        players: allSelectedPlayers.map(p => p.id),
        teamA: teams[0].map(p => p.id),
        teamB: teams[1].map(p => p.id),
        captainIds: captains,
        categoryId: category.id,
        textChannelId: textChannel.id,
        voiceAId: vcs[0],
        voiceBId: vcs[1],
        queueType: `${teamSize}v${teamSize}`,
        map: selectedMap,
        startedAt: Date.now(),
        status: 'pending',
        rules,
        isPartyMatch: options.isPartyMatch || false
      };

      await setActiveGame(hex, matchData);
      
      const teamMentions = teams.map(team => team.map(m => `<@${m.id}>`));
      const teamCaptainsMention = captains.map(id => `<@${id}>`);

      const embeds = [
        {
          title: `Welcome to Match #${hex}`,
          description:
            `🗺️ **Map:** ${selectedMap}\n\n` +
            `👑 **Team Captains:**\n• Team 1: ${teamCaptainsMention[0]}\n• Team 2: ${teamCaptainsMention[1]}\n\n` +
            `👥 **Teams:**\n• **Team 1:** ${teamMentions[0].join(', ')}\n• **Team 2:** ${teamMentions[1].join(', ')}\n\n` +
            `📜 **Match Rules:**\n• Note: Standard rules apply.\n\n` +
            `${rules.rulesEmbed || ''}`,
          color: 0x00ff00
        }
      ];

      await textChannel.send({ embeds });
      textChannel.send(allSelectedPlayers.map(p => `<@${p.id}>`).join(' '));

      // Publish to Redis immediately for normal matches
      await publishMatchData(guild, hex, matchData);
    }

  } catch (err) {
    console.error(`[createMatch] Failed to create match #${hex}:`, err);
  } finally {
    // Release player locks after a short delay
    allCandidateIds.forEach(id => {
      setTimeout(() => playerLocks.delete(id), 15000);
    });
  }
}

async function publishMatchData(guild, hex, matchData) {
  try {
    const [teamAData, teamBData] = await Promise.all([
      Promise.all(matchData.teamA.map(async id => {
        const m = await guild.members.fetch(id).catch(() => null);
        const p = await Player.load(m || { id, user: { username: 'Unknown' }, displayName: 'Unknown' });
        return { id: p.id, ign: p.ingameUsername, elo: p.elo };
      })),
      Promise.all(matchData.teamB.map(async id => {
        const m = await guild.members.fetch(id).catch(() => null);
        const p = await Player.load(m || { id, user: { username: 'Unknown' }, displayName: 'Unknown' });
        return { id: p.id, ign: p.ingameUsername, elo: p.elo };
      }))
    ]);

    const formattedMap = `w_4_0_${matchData.map.toLowerCase()}`;
    await publishMatch({
      matchId: hex,
      queueType: matchData.queueType,
      map: formattedMap,
      teamA: teamAData,
      teamB: teamBData
    });
  } catch (err) {
    console.error('[Redis-Bridge] Failed to publish:', err);
  }
}

// -------------------------
// Rules
// -------------------------
function getRulesForMatchType(teamSize) {
  if (teamSize === 3 || teamSize === 4) {
    const section = _queueRules[`${teamSize}v${teamSize}`];
    if (!section) return fallbackRules(teamSize);

    const formatSection = (title, list) =>
      list?.length ? `**${title}:**\n> ${list.map(i => i.trim()).join('\n> ')}\n` : '';

    const rulesText = [
      formatSection('✅ Allowed', section.allowed),
      formatSection('🕒 After Emerald II', section.after_emerald_ii),
      formatSection('💥 After Any Bed Break', section.after_any_bed_break),
      formatSection('⛔ Banned', section.banned)
    ].join('\n');

    return {
      format: `${teamSize}v${teamSize}`,
      rulesEmbed: rulesText
    };
  }
  return fallbackRules(teamSize);
}

function fallbackRules(teamSize) {
  return {
    format: teamSize === 1 ? '1v1' : `${teamSize}v${teamSize}`,
    rulesEmbed: ''
  };
}

// -------------------------
// Permissions
// -------------------------
function getPermissionOverwrites(players, permissions, isTextChannel = false) {
  const perms = Array.isArray(permissions) ? permissions : [permissions];
  const overwrites = [];
  const everyoneRoleId = players[0].guild.roles.everyone.id;

  if (isTextChannel) {
    overwrites.push({ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] });
  } else {
    overwrites.push({ id: everyoneRoleId, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] });
  }

  return overwrites.concat(players.map(p => ({ id: p.id, allow: perms })));
}

// -------------------------
// Move players
// -------------------------
async function movePlayersToVoiceChannels(guild, teams, voiceChannels) {
  const moveTasks = [];

  teams.forEach((team, i) => {
    const targetVC = voiceChannels[i];
    if (!targetVC) return;
    
    team.forEach(p => {
      // p is already a GuildMember object with voice state from the selection phase
      if (p.voice?.channelId) {
        moveTasks.push(p.voice.setChannel(targetVC).catch(() => {}));
      }
    });
  });

  // This executes ALL move requests at the exact same moment
  await Promise.all(moveTasks);
}

const { redis } = require('../utils/redisClient');
const ActiveGame = require('../models/ActiveGame');

async function setActiveGame(gameId, data) {
  console.log(`[ActiveGames] Saving game #${gameId}. Category ID provided: ${data.categoryId}`);
  // Ensure we are working with a complete data object
  const game = new ActiveGame(data);
  await game.save();
  console.log(`[ActiveGames] Successfully saved game #${gameId} to Redis and Mongo.`);
}

async function updateActiveGame(gameId, updateData) {
  const game = await ActiveGame.load(gameId);
  if (!game) return;
  Object.assign(game, updateData);
  await game.save();
}

async function deleteActiveGame(gameId) {
  const game = await ActiveGame.load(gameId);
  if (game) await game.delete();
}

async function getActiveGames() {
  const keys = await redis.keys('game:*');
  const games = await Promise.all(keys.map(async key => {
    const raw = await redis.get(key);
    return JSON.parse(raw);
  }));
  return games;
}

// Note: loadActiveGames is now largely handled by ActiveGame.load on demand
async function loadActiveGames() {
  console.log('[ActiveGames] Migration to Redis complete. Using on-demand loading.');
}


async function startQueuePolling(client) {
  const eloQueues = require('../config/eloQueues');
  const guildId = process.env.GUILD_ID;
  if (!guildId) return;

  console.log('[QueuePolling] Started 1-second queue detection.');

  setInterval(async () => {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      const allChannels = guild.channels.cache;

      await Promise.all(eloQueues.map(async (queue) => {
        const { voiceChannelId, type } = queue;
        if (!voiceChannelId || !type) return;

        if (queueLocks.get(voiceChannelId)) return;

        const voiceChannel = allChannels.get(voiceChannelId);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

        let members = [...voiceChannel.members.values()];
        if (members.length === 0) return;

        // --- Party Restriction for 600+ Queue ---
        const isHighTierQueue = queue.minElo >= 600;
        if (isHighTierQueue) {
          const membersToRemove = [];
          members = members.filter(member => {
            const party = partySystem.getPartyByUser(member.id);
            if (party && party.members.length > 1) {
              membersToRemove.push(member);
              return false;
            }
            return true;
          });

          if (membersToRemove.length > 0) {
            for (const member of membersToRemove) {
              console.log(`[QueuePolling] Removing ${member.user.username} from 600+ queue (Parties not allowed).`);
              
              // Send a DM or try to notify them
              member.send("⚠️ **Parties are not allowed in the 600+ ELO queue.** Please leave your party or join a different queue.").catch(() => {});

              // Move them back
              const fallbackQueue = eloQueues.find(q => q.minElo < 600 && q.voiceChannelId !== voiceChannelId);
              if (fallbackQueue) {
                await member.voice.setChannel(fallbackQueue.voiceChannelId).catch(() => {});
              } else {
                await member.voice.setChannel(null).catch(() => {}); // Disconnect if no fallback
              }
            }
          }
        }

        // Filter by role if required
        if (queue.requiredRoleId) {
          members = members.filter(m => m.roles.cache.has(queue.requiredRoleId));
        }

        // Optional: Track join time for players (already handled by voiceStateUpdate usually)
        // members.forEach(member => trackJoin(member.id));

        const expectedCount = type === '3v3' ? 6 : type === '4v4' ? 8 : 2;
        if (members.length < expectedCount) return;

        try {
          const handlerPath = `./queue${type}`;
          const queueHandler = require(handlerPath);
          if (typeof queueHandler.handleQueue === 'function') {
            queueLocks.set(voiceChannelId, true);
            await queueHandler.handleQueue(guild, members, queue);
            setTimeout(() => queueLocks.delete(voiceChannelId), 10000);
          }
        } catch (err) {
          queueLocks.delete(voiceChannelId);
        }
      }));
    } catch (err) {
      console.error('[QueuePolling] Error:', err);
    }
  }, 1000);
}

module.exports = {
  getActiveGames,
  createMatch,
  setActiveGame,
  updateActiveGame,
  deleteActiveGame,
  loadActiveGames,
  getEligiblePlayers,
  checkAllQueueChannelsOnStartup,
  startQueuePolling,
  queueLocks,
  getPermissionOverwrites
};
