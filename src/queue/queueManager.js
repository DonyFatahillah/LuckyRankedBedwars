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

  for (const queue of eloQueues) {
    const { voiceChannelId, type } = queue;
    if (!voiceChannelId || !type) continue;

    const voiceChannel = allChannels.get(voiceChannelId);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) continue;

    const members = [...voiceChannel.members.values()];
    if (members.length === 0) continue;

    // Track join time for players already in VC
    for (const member of members) {
      trackJoin(member.id);
    }

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
  }
}

function generateHexCode() {
  let hex;
  do {
    hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
  } while (_activeGames.has(hex));
  return hex;
}

function getEligiblePlayers(members, targetCount, maxPartySize = 4) {
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
      
      // Calculate group join time (earliest member)
      const groupJoinTime = Math.min(...presentMembers.map(m => getJoinTime(m.id)));
      
      if (presentMembers.length > maxPartySize) {
        for (let i = 0; i < presentMembers.length; i += maxPartySize) {
          const slice = presentMembers.slice(i, i + maxPartySize);
          partyGroups.push({ 
            members: slice, 
            joinTime: groupJoinTime 
          });
        }
      } else {
        partyGroups.push({ 
          members: presentMembers, 
          joinTime: groupJoinTime 
        });
      }

      processedParties.add(party.leaderId);

    } else if (!party) {
      soloMembers.push({ 
        member, 
        joinTime: getJoinTime(member.id) 
      });
    }
  }

  // Sort party groups by join time (earliest first)
  partyGroups.sort((a, b) => a.joinTime - b.joinTime);
  // Sort solo members by join time (earliest first)
  soloMembers.sort((a, b) => a.joinTime - b.joinTime);

  const combined = [];
  let total = 0;

  // Fill with parties first (they are already sorted by join time)
  for (const group of partyGroups) {
    if (total + group.members.length <= targetCount) {
      combined.push(...group.members);
      total += group.members.length;
    }
    if (total === targetCount) break;
  }

  // Fill remaining slots with solo members (sorted by join time)
  if (total < targetCount) {
    for (const solo of soloMembers) {
      if (total < targetCount) {
        combined.push(solo.member);
        total++;
      } else {
        break;
      }
    }
  }

  return combined;
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
  players = getEligiblePlayers(players, totalRequired, teamSize);
  if (players.length < totalRequired) return;

  const eloQueue = options.eloQueue;
  const isHighTier = eloQueue && eloQueue.minElo >= 600;

  const hex = generateHexCode();
  const team1 = players.slice(0, teamSize);
  const team2 = players.slice(teamSize, teamSize * 2);
  const teams = [team1, team2];

  const captains = await Promise.all(
    teams.map(async team => {
      const instances = await Promise.all(team.map(m => new Player(m)));
      return instances.reduce((top, p) => (p.elo > top.elo ? p : top), instances[0]).member.id;
    })
  );

  const rules = getRulesForMatchType(teamSize);

  try {
    const category = await guild.channels.create({
      name: `#${hex} Game`,
      type: ChannelType.GuildCategory,
      permissionOverwrites: getPermissionOverwrites(players, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ], true)
    });

    const textChannel = await guild.channels.create({
      name: `${hex}-chat`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: getPermissionOverwrites(players, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ], true)
    });

    let selectedMap;
    const vcs = [];

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
        const member = await guild.members.fetch(p.id).catch(() => null);
        if (member) return member.voice.setChannel(waitingRoom).catch(() => {});
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
        content: players.map(p => `<@${p.id}>`).join(' '),
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
        if (!players.some(p => p.id === i.user.id)) {
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

      // 4. Create Team VCs
      for (let i = 0; i < teams.length; i++) {
        const vc = await guild.channels.create({
          name: `#${hex} Team ${i + 1}`,
          type: ChannelType.GuildVoice,
          parent: category.id,
          permissionOverwrites: getPermissionOverwrites(teams[i], PermissionFlagsBits.Connect, false)
        });
        vcs.push(vc.id);
      }

      // 5. Move players to Team VCs
      await movePlayersToVoiceChannels(guild, teams, category.id, vcs);
      
      // 6. Delete Waiting Room
      await waitingRoom.delete().catch(() => {});

    } else {
      // Normal flow
      selectedMap = mapPicker.getRandomMap();
      for (let i = 0; i < teams.length; i++) {
        const vc = await guild.channels.create({
          name: `#${hex} Team ${i + 1}`,
          type: ChannelType.GuildVoice,
          parent: category.id,
          permissionOverwrites: getPermissionOverwrites(teams[i], PermissionFlagsBits.Connect, false)
        });
        vcs.push(vc.id);
      }
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

    await textChannel.send({ embeds });
    if (!isHighTier) await textChannel.send(players.map(p => `<@${p.id}>`).join(' '));

    const matchData = {
      gameId: hex,
      players: players.map(p => p.id),
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

    await logMatch(hex, matchData.teamA, matchData.teamB, { 
      queueType: matchData.queueType, 
      mapName: matchData.map 
    });
    await setActiveGame(hex, matchData);

    // Publish to Redis for Minecraft Bridge
    const teamAData = await Promise.all(teams[0].map(async m => {
      const p = await Player.load(m);
      return { id: p.id, ign: p.ingameUsername, elo: p.elo };
    }));
    const teamBData = await Promise.all(teams[1].map(async m => {
      const p = await Player.load(m);
      return { id: p.id, ign: p.ingameUsername, elo: p.elo };
    }));

    const formattedMap = `w_4_0_${matchData.map.toLowerCase()}`;

    await publishMatch({
      matchId: hex,
      queueType: matchData.queueType,
      map: formattedMap,
      teamA: teamAData,
      teamB: teamBData
    }).catch(err => console.error('[Redis-Bridge] Failed to publish:', err));

    if (process.env.MATCH_LOGS_ID) {
      await sendLogToStaffChannel(guild.client, guild.id, hex, process.env.MATCH_LOGS_ID);
    }

  } catch (err) {
    console.error(`[createMatch] Failed to create match #${hex}:`, err);
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
      //map: `Random ${teamSize}v${teamSize} Map`,
      //rounds: 1,
      //bedBreakEnabled: true,
      rulesEmbed: rulesText
    };
  }
  return fallbackRules(teamSize);
}

function fallbackRules(teamSize) {
  return {
    format: teamSize === 1 ? '1v1' : `${teamSize}v${teamSize}`,
    //map: `Random ${teamSize}v${teamSize} Map`,
   // rounds: 1,
    //bedBreakEnabled: true,
    //mvpBonus: true,
   // note: 'Standard rules apply.',
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
async function movePlayersToVoiceChannels(guild, teams, categoryId, specificVoiceIds = null) {
  let voiceChannels;
  
  if (specificVoiceIds && specificVoiceIds.length > 0) {
    const allChannels = await guild.channels.fetch();
    voiceChannels = specificVoiceIds.map(id => allChannels.get(id)).filter(Boolean);
  } else {
    const allChannels = await guild.channels.fetch();
    voiceChannels = Array.from(allChannels.values())
      .filter(c => c.parentId === categoryId && c.type === ChannelType.GuildVoice)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  teams.forEach((team, i) => team.forEach(p => p.targetVC = voiceChannels[i]));

  const movePromises = teams.flat().map(async p => {
    const member = await guild.members.fetch(p.id).catch(() => null);
    if (member && p.targetVC) return member.voice.setChannel(p.targetVC).catch(() => {});
  });

  await Promise.all(movePromises);
}

// -------------------------
// Persistence
// -------------------------
function saveActiveGames() {
  fs.writeFileSync(ACTIVE_GAMES_PATH, JSON.stringify(Array.from(_activeGames.entries()), null, 2));
}

async function loadActiveGames() {
  if (!fs.existsSync(ACTIVE_GAMES_PATH)) return;
  try {
    const data = JSON.parse(fs.readFileSync(ACTIVE_GAMES_PATH));
    _activeGames = new Map(data);
    console.log(`[ActiveGames] Loaded ${_activeGames.size} games.`);
  } catch (err) {
    console.error(`[ActiveGames] Failed to load:`, err);
    _activeGames = new Map();
  }
}

async function setActiveGame(gameId, data) {
  _activeGames.set(gameId, data);
  saveActiveGames();

  // Mongo Sync
  try {
    await ActiveGameModel.findOneAndUpdate(
      { gameId },
      data,
      { upsert: true }
    );
  } catch (err) {
    console.error(`[ActiveGames-Mongo] Failed to save game #${gameId}:`, err);
  }
}

async function updateActiveGame(gameId, updateData) {
  const match = _activeGames.get(gameId);
  if (!match) return;
  await setActiveGame(gameId, { ...match, ...updateData });
}

async function deleteActiveGame(gameId) {
  _activeGames.delete(gameId);
  saveActiveGames();

  try {
    await ActiveGameModel.deleteOne({ gameId });
  } catch (err) {
    console.error(`[ActiveGames-Mongo] Failed to delete game #${gameId}:`, err);
  }
}

function getActiveGames() {
  return _activeGames;
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
