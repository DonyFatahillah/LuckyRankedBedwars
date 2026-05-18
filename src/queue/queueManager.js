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

try {
  const raw = fs.readFileSync(RULES_YAML_PATH, 'utf8');
  _queueRules = yaml.load(raw);
} catch (err) {
  console.warn('[QueueRules] Failed to load YAML rules:', err.message);
}

const { logMatch, sendLogToStaffChannel } = require('../utils/matchLogger');
const Player = require('../models/Player');
const partySystem = require('../utils/partySystem');
const { publishMatch } = require('../utils/redisClient');
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

function getEligibleGroups(members, targetCount, maxTeamSize = 4) {
  const soloMembers = [];
  const partyGroups = [];
  const memberMap = new Map(members.map(m => [m.id, m]));
  const processedParties = new Set();

  for (const member of members) {
    const party = partySystem.getPartyByUser(member.id);

    if (party && !processedParties.has(party.leaderId)) {
      const presentMembers = party.members
        .map(id => memberMap.get(id))
        .filter(Boolean);

      if (presentMembers.length === 0) continue;
      
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

function getEligiblePlayers(members, targetCount, maxTeamSize = 4) {
  const groups = getEligibleGroups(members, targetCount, maxTeamSize);
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
  const eligibleGroups = getEligibleGroups(players, totalRequired, teamSize);
  
  let totalSelected = 0;
  eligibleGroups.forEach(g => totalSelected += g.members.length);
  if (totalSelected < totalRequired) return;

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
        permissionOverwrites: getPermissionOverwrites(players, PermissionFlagsBits.Connect, false)
      });

      // 2. Move players to Waiting Room (Parallel)
      await Promise.all(players.map(async p => {
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
      const row = new ActionRowBuilder().addComponents(
        maps.map((map, index) => 
          new ButtonBuilder()
            .setCustomId(`map_vote_${index}`)
            .setLabel(map)
            .setStyle(ButtonStyle.Primary)
        )
      );

      const voteEmbed = {
        title: "🗺️ Map Selection",
        description: "Vote for the map you want to play! You have 20 seconds.",
        fields: maps.map((m, i) => ({ name: `Map ${i + 1}`, value: m, inline: true })),
        color: 0x0099ff
      };

      const voteMessage = await textChannel.send({
        content: allSelectedPlayers.map(p => `<@${p.id}>`).join(' '),
        embeds: [voteEmbed],
        components: [row]
      });

      const votes = new Array(maps.length).fill(0);
      const voterIds = new Set();

      const collector = voteMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 20000
      });

      collector.on('collect', async i => {
        if (!allSelectedPlayers.some(p => p.id === i.user.id)) {
          return i.reply({ content: "You are not in this match!", ephemeral: true });
        }
        if (voterIds.has(i.user.id)) {
          return i.reply({ content: "You already voted!", ephemeral: true });
        }

        const index = parseInt(i.customId.split('_')[2]);
        votes[index]++;
        voterIds.add(i.user.id);
        await i.reply({ content: `You voted for **${maps[index]}**!`, ephemeral: true });
      });

      await new Promise(resolve => collector.on('end', resolve));

      const maxVotes = Math.max(...votes);
      const winners = maps.filter((_, index) => votes[index] === maxVotes);
      selectedMap = winners[Math.floor(Math.random() * winners.length)];

      await voteMessage.edit({
        content: `✅ **Selected Map:** ${selectedMap}`,
        embeds: [],
        components: []
      });

      // 4. Create Team VCs in parallel
      const teamVCTasks = teams.map((team, i) => guild.channels.create({
        name: `#${hex} Team ${i + 1}`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: getPermissionOverwrites(team, PermissionFlagsBits.Connect, false)
      }));
      const createdTeamVCs = await Promise.all(teamVCTasks);
      createdTeamVCs.forEach(vc => vcs.push(vc.id));

      // 5. Move players to Team VCs
      await movePlayersToVoiceChannels(guild, teams, category.id, vcs);
      
      // 6. Delete Waiting Room
      await waitingRoom.delete().catch(() => {});

    } else {
      // Normal flow
      selectedMap = mapPicker.getRandomMap();
      await movePlayersToVoiceChannels(guild, teams, category.id, vcs);
    }

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

    const messagePromise = textChannel.send({ embeds });
    if (!isHighTier) textChannel.send(allSelectedPlayers.map(p => `<@${p.id}>`).join(' '));

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

    // Parallelize saves, logs, and redis publication
    const postMatchTasks = [
      logMatch(hex, matchData.teamA, matchData.teamB, { 
        queueType: matchData.queueType, 
        mapName: matchData.map 
      }),
      setActiveGame(hex, matchData),
      (async () => {
        const [teamAData, teamBData] = await Promise.all([
          Promise.all(teams[0].map(async m => {
            const p = await Player.load(m);
            return { id: p.id, ign: p.ingameUsername, elo: p.elo };
          })),
          Promise.all(teams[1].map(async m => {
            const p = await Player.load(m);
            return { id: p.id, ign: p.ingameUsername, elo: p.elo };
          }))
        ]);

        const formattedMap = `w_4_0_${matchData.map.toLowerCase()}`;
        return publishMatch({
          matchId: hex,
          queueType: matchData.queueType,
          map: formattedMap,
          teamA: teamAData,
          teamB: teamBData
        });
      })().catch(err => console.error('[Redis-Bridge] Failed to publish:', err))
    ];

    if (process.env.MATCH_LOGS_ID) {
      postMatchTasks.push(sendLogToStaffChannel(guild.client, guild.id, hex, process.env.MATCH_LOGS_ID));
    }

    await Promise.all([messagePromise, ...postMatchTasks]);

  } catch (err) {
    console.error(`[createMatch] Failed to create match #${hex}:`, err);
  }
}

// ... rest of rules functions ...

// -------------------------
// Move players
// -------------------------
async function movePlayersToVoiceChannels(guild, teams, categoryId, specificVoiceIds = null) {
  let voiceChannels;
  
  const allChannels = await guild.channels.fetch();
  if (specificVoiceIds && specificVoiceIds.length > 0) {
    voiceChannels = specificVoiceIds.map(id => allChannels.get(id)).filter(Boolean);
  } else {
    voiceChannels = Array.from(allChannels.values())
      .filter(c => c.parentId === categoryId && c.type === ChannelType.GuildVoice)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const moveTasks = [];
  teams.forEach((team, i) => {
    const targetVC = voiceChannels[i];
    if (!targetVC) return;
    
    team.forEach(p => {
      moveTasks.push((async () => {
        if (p.voice?.channelId) {
          await p.voice.setChannel(targetVC).catch(() => {});
        } else {
          // Fallback fetch if voice state is missing
          const member = await guild.members.fetch(p.id).catch(() => null);
          if (member?.voice.channelId) {
            await member.voice.setChannel(targetVC).catch(() => {});
          }
        }
      })());
    });
  });

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


module.exports = {
  getActiveGames,
  createMatch,
  setActiveGame,
  updateActiveGame,
  deleteActiveGame,
  loadActiveGames,
  getEligiblePlayers,
  checkAllQueueChannelsOnStartup
};
