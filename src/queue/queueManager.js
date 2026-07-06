// src/queue/queueManager.js
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder } = require('discord.js');
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
const { publishMatch, getPlayerOnlineStatus, publishMatchVoid, publishPlayerOnline } = require('../utils/redisClient');
const { trackJoin, getJoinTime } = require('../utils/voiceJoinTracker');
const eloQueues = require('../config/eloQueues');
const ONLINE_CHECK_TIMEOUT_MS = 10000;
const ONLINE_CHECK_INTERVAL_MS = 250;

// 🧠 Startup queue check
async function checkAllQueueChannelsOnStartup(client) {
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

    // Request fresh online check for everyone found on startup
    await requestOnlineChecks(members, true);

    const onlineConfirmed = await waitForOnlineChecks(members, 'StartupQueue');
    if (!onlineConfirmed) {
      console.log(`[StartupQueue] Skipping queue ${type} until online status is confirmed.`);
      return;
    }

    console.log(`[StartupQueue] Found ${members.length} in queue ${type} → ${voiceChannel.name}`);

    try {
      const handlerPath = `./queue${type}`;
      const queueHandler = require(handlerPath);
      if (typeof queueHandler.handleQueue === 'function') {
        await queueHandler.handleQueue(guild, members, queue);
      } else {
        console.warn(`[StartupQueue] Missing handleQueue() in ${handlerPath}`);
      }
    } catch (err) {
      console.error(`[StartupQueue] Failed to handle queue type ${type}:`, err);
    }
  }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateHexCode() {
  let hex;
  do {
    hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
  } while (_activeGames.has(hex));
  return hex;
}

async function requestOnlineChecks(members, force = false) {
  await Promise.all(members.map(async member => {
    if (!force) {
      const status = await getPlayerOnlineStatus(member.id);
      if (status && (status.status === 'online' || status.status === 'offline' || status.status === 'check')) {
        return;
      }
    }
    const player = await Player.load(member);
    const username = player.ingameUsername || member.user.username;
    await publishPlayerOnline(member.id, username, 'check');
  }));
}

async function waitForOnlineChecks(members, logPrefix) {
  const deadline = Date.now() + ONLINE_CHECK_TIMEOUT_MS;
  let pendingMembers = [...members];
  const finalStatuses = [];

  let lastPendingStr = "";

  while (pendingMembers.length > 0 && Date.now() < deadline) {
    const currentStatuses = await getOnlineStatuses(pendingMembers);
    const stillPending = [];
    
    currentStatuses.forEach(({ member, data }) => {
      if (!data || data.status === 'check') {
        stillPending.push(member);
      } else {
        finalStatuses.push({ member, data });
      }
    });

    pendingMembers = stillPending;

    if (pendingMembers.length > 0) {
      const pendingNames = pendingMembers.map(m => `${m.displayName} (${m.id})`).join(', ');
      if (pendingNames !== lastPendingStr) {
        console.log(`[${logPrefix}] Waiting for Redis online check: ${pendingNames}`);
        lastPendingStr = pendingNames;
      }
      await sleep(ONLINE_CHECK_INTERVAL_MS);
    }
  }

  if (pendingMembers.length > 0) {
    const unresolved = pendingMembers.map(member => ({ member }));
    console.log(`[${logPrefix}] Redis online check timed out for: ${formatMembers(unresolved)}`);
    return false;
  }

  const offline = finalStatuses.filter(({ data }) => data.status !== 'online');
  if (offline.length > 0) {
    console.log(`[${logPrefix}] Queue blocked by non-online players: ${formatStatusMembers(offline)}`);
    return false;
  }

  return true;
}

async function moveIneligiblePlayer(member, reason, queueConfig = null) {
  const WAITING_ROOM_ID = process.env.WAITING_ROOM_VOICE_ID;
  if (!WAITING_ROOM_ID) return;

  const waitingRoom = member.guild.channels.cache.get(WAITING_ROOM_ID);
  if (waitingRoom && member.voice.channelId !== WAITING_ROOM_ID) {
    await member.voice.setChannel(waitingRoom).catch(() => {});
  }

  let msg;
  if (reason === 'offline') {
    msg = "⚠️ You were moved to the waiting room because you are not online in-game. Please join the server to queue.";
  } else if (reason === 'ELO ineligible' && queueConfig) {
    msg = `❌ You must be between ${queueConfig.minElo}-${queueConfig.maxElo} ELO for the ${queueConfig.type} queue.`;
  } else if (reason === 'party') {
    msg = "⚠️ **Parties are not allowed in the 600+ ELO queue.** Please leave your party or join a different queue.";
  } else {
    msg = `🚫 You were moved to the waiting room because you are ${reason} from the ranked queue.`;
  }

  await member.send(msg).catch(() => {});
}

async function validateQueueMembers(guild, voiceChannel, queueConfig, options = { forceCheck: false, wait: true }) {
  let members = [...voiceChannel.members.values()];
  if (members.length === 0) return [];

  const BANNED_ROLE = process.env.RANKED_BANNED_ROLE_ID;
  const BLACKLISTED_ROLE = process.env.BLACKLISTED_ROLE_ID;

  // 1. Request fresh online checks if needed
  await requestOnlineChecks(members, options.forceCheck);
  
  // 2. Wait for checks if requested, or skip if pending
  if (options.wait) {
    await waitForOnlineChecks(members, 'Validation');
  } else {
    const statuses = await getOnlineStatuses(members);
    if (hasPendingOnlineCheck(statuses)) return []; // Not ready yet, skip this polling iteration
  }

  // 3. Collect final statuses and re-validate everything
  const onlineStatuses = await Promise.all(members.map(m => getPlayerOnlineStatus(m.id)));
  const memberStatuses = new Map(members.map((m, i) => [m.id, onlineStatuses[i]]));


  const eligible = [];
  for (const member of members) {
    const isBanned = BANNED_ROLE && member.roles.cache.has(BANNED_ROLE);
    const isBlacklisted = BLACKLISTED_ROLE && member.roles.cache.has(BLACKLISTED_ROLE);
    const statusData = memberStatuses.get(member.id);
    const isOffline = !statusData || statusData.status !== 'online';
    
    // ELO Check
    let isEloIneligible = false;
    if (queueConfig && (queueConfig.minElo !== undefined || queueConfig.maxElo !== undefined)) {
      const player = await Player.load(member);
      if (player.elo < (queueConfig.minElo || 0) || player.elo > (queueConfig.maxElo || Infinity)) {
        isEloIneligible = true;
      }
    }

    // Party Check (600+)
    let isPartyIneligible = false;
    if (queueConfig?.minElo >= 600) {
      const party = await partySystem.getPartyByUser(member.id);
      if (party && party.members.length > 1) {
        isPartyIneligible = true;
      }
    }

    if (isBanned || isBlacklisted || isOffline || isEloIneligible || isPartyIneligible) {
      const reason = isBanned ? 'banned' : (isBlacklisted ? 'blacklisted' : (isOffline ? 'offline' : (isEloIneligible ? 'ELO ineligible' : 'party')));
      console.log(`[Validation] Moving ${member.user.username} to waiting room (${reason}).`);
      await moveIneligiblePlayer(member, reason, queueConfig);
    } else {
      eligible.push(member);
    }
  }

  return eligible;
}

async function getOnlineStatuses(members) {
  return Promise.all(members.map(async member => ({
    member,
    data: await getPlayerOnlineStatus(member.id)
  })));
}

function hasPendingOnlineCheck(statuses) {
  return statuses.some(({ data }) => !data || data.status === 'check');
}

function formatMembers(entries) {
  return entries.map(({ member }) => `${member.displayName} (${member.id})`).join(', ');
}

function formatStatusMembers(entries) {
  return entries
    .map(({ member, data }) => `${member.displayName} (${member.id}): ${data?.status || 'unknown'}`)
    .join(', ');
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
    const isBanned = member.roles.cache.has(process.env.RANKED_BANNED_ROLE_ID);
    const isBlacklisted = member.roles.cache.has(process.env.BLACKLISTED_ROLE_ID);
    return player && player.ingameUsername && player.ingameUsername.trim() !== "" && isOnline && !isBanned && !isBlacklisted;
  });

  for (const member of validMembers) {
    const party = await partySystem.getPartyByUser(member.id);

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
  const usePlayerPicking = eloQueue && eloQueues.isPlayerPicking(eloQueue.voiceChannelId);
  const useArenaPicking = eloQueue && eloQueues.isArenaPicking(eloQueue.voiceChannelId);

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

  const isPremiumQueue = options.eloQueue?.requiredRoleId !== undefined;

  const captains = await Promise.all(
    teams.map(async team => {
      const instances = await Promise.all(team.map(m => Player.load(m)));
      
      const getPremiumLevel = (member) => {
        if (process.env.PREMIUM_ROLE_ID && member.roles.cache.has(process.env.PREMIUM_ROLE_ID)) return 4;
        if (process.env.PUGS_ROLE_ID && member.roles.cache.has(process.env.PUGS_ROLE_ID)) return 3;
        if (process.env.PUPS_ROLE_ID && member.roles.cache.has(process.env.PUPS_ROLE_ID)) return 2;
        if (process.env.PITS_ROLE_ID && member.roles.cache.has(process.env.PITS_ROLE_ID)) return 1;
        return 0;
      };

      const shuffled = shuffle([...instances]);
      const sorted = shuffled.sort((a, b) => {
        const aLevel = getPremiumLevel(a.member);
        const bLevel = getPremiumLevel(b.member);
        
        if (aLevel !== bLevel) {
          return bLevel - aLevel;
        }
        
        if (a.isPremium && !b.isPremium) return -1;
        if (!a.isPremium && b.isPremium) return 1;
        
        if (isPremiumQueue) return 0;
        
        return b.elo - a.elo;
      });
      
      return sorted[0].member.id;
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

    const { startMapVoting } = require('../utils/matchFinalizer');
    const needsWaitingRoom = usePlayerPicking || useArenaPicking;

    if (!needsWaitingRoom) {
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
    const vcs = !needsWaitingRoom ? createdChannels.slice(1).map(c => c.id) : [];

    let selectedMap;

    if (needsWaitingRoom) {
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

      if (usePlayerPicking) {
        // 3. --- SETUP PICKING PHASE ---
        const unpicked = allSelectedPlayers
          .map(p => p.id)
          .filter(id => !captains.includes(id));

        const firstPickCaptain = captains[Math.floor(Math.random() * captains.length)];

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
          map: "TBD", // To be selected after picking
          startedAt: Date.now(),
          status: 'picking',
          pickingPhase: true,
          pickingTurn: firstPickCaptain, // Randomly selected captain starts
          unpickedPlayers: unpicked,
          isPlayerPicking: true,
          isArenaPicking: useArenaPicking,
          rules,
          isPartyMatch: options.isPartyMatch || false
        };

        await setActiveGame(hex, matchData);

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`picking-select-${hex}`)
          .setPlaceholder('Select a player to pick')
          .addOptions(unpicked.map(id => {
            const p = allSelectedPlayers.find(player => player.id === id);
            return {
              label: p.displayName || p.user.username || id,
              value: id
            };
          }));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const pickingEmbed = {
          title: "🎮 Picking Phase Started",
          description: `Captain <@${firstPickCaptain}>, it's your turn to pick a player!\nUse the dropdown below to choose from the pool.`,
          fields: [
            { name: "Pool", value: unpicked.map(id => `<@${id}>`).join('\n') || "None", inline: true },
            { name: "Team 1", value: `<@${captains[0]}> (Captain)`, inline: true },
            { name: "Team 2", value: `<@${captains[1]}> (Captain)`, inline: true }
          ],
          color: 0xffff00
        };

        await textChannel.send({ 
          content: allSelectedPlayers.map(p => `<@${p.id}>`).join(' '),
          embeds: [pickingEmbed], 
          components: [row] 
        });
      } else {
        // useArenaPicking is true, usePlayerPicking is false
        const matchData = {
          gameId: hex,
          players: allSelectedPlayers.map(p => p.id),
          teamA: teams[0].map(p => p.id),
          teamB: teams[1].map(p => p.id),
          captainIds: captains,
          categoryId: category.id,
          textChannelId: textChannel.id,
          voiceAId: null,
          voiceBId: null,
          queueType: `${teamSize}v${teamSize}`,
          map: "TBD",
          startedAt: Date.now(),
          status: 'voting',
          isPlayerPicking: false,
          isArenaPicking: true,
          rules,
          isPartyMatch: options.isPartyMatch || false
        };

        await setActiveGame(hex, matchData);
        await startMapVoting(guild, textChannel, matchData);
      }

    } else {
      // Normal flow (Neither picking nor arena voting)
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
        isPlayerPicking: false,
        isArenaPicking: false,
        rules,
        isPartyMatch: options.isPartyMatch || false
      };

      await setActiveGame(hex, matchData);
      
      const teamMentions = teams.map((team, teamIndex) => 
        team.map(m => m.id === captains[teamIndex] ? `<@${m.id}> (Captain)` : `<@${m.id}>`)
      );
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

      await logMatch(hex, matchData.teamA, matchData.teamB, {
        queueType: matchData.queueType,
        mapName: matchData.map
      });

      if (process.env.MATCH_LOGS_ID) {
        await sendLogToStaffChannel(guild.client, guild.id, hex, process.env.MATCH_LOGS_ID);
      }
    }

  } catch (err) {
    console.error(`[createMatch] Failed to create match #${hex}:`, err);
  } finally {
    // Release player locks after a short delay
    allCandidateIds.forEach(id => {
      setTimeout(() => playerLocks.delete(id), 15000);
    });
  }

  return captains;
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

        // Use the centralized validation function with non-blocking check
        const members = await validateQueueMembers(guild, voiceChannel, queue, { wait: false });

        if (members.length === 0) return;

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
  getPermissionOverwrites,
  validateQueueMembers,
  moveIneligiblePlayer
};
