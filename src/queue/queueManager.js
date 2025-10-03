// src/queue/queueManager.js
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config({ path: path.join(__dirname, '/../.env') });

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

function generateHexCode() {
  let hex;
  do {
    hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
  } while (_activeGames.has(hex));
  return hex;
}

function getEligiblePlayers(members, targetCount, maxPartySize = 2) {
  const soloMembers = [];
  const partyGroups = [];
  const usedPartyLeaders = new Set();

  // Separate solo players and parties
  for (const member of members) {
    const party = partySystem.getPartyByUser(member.id);
    if (party && !usedPartyLeaders.has(party.leaderId)) {
      const partyMembers = party.members
        .map(id => members.find(m => m.id === id))
        .filter(Boolean);

      // Skip oversized parties
      if (partyMembers.length > maxPartySize) {
        console.log(`[Queue] Party led by ${party.leaderId} skipped (size ${partyMembers.length} > max ${maxPartySize})`);
        continue;
      }

      if (partyMembers.length > 0) {
        partyGroups.push(partyMembers);
        usedPartyLeaders.add(party.leaderId);
      }
    } else if (!party) {
      soloMembers.push(member);
    }
  }

  // Shuffle parties and solos for randomness
  shuffle(partyGroups);
  shuffle(soloMembers);

  // Sort parties descending by size
  partyGroups.sort((a, b) => b.length - a.length);

  // Combine parties and solos to match targetCount
  return combinePartiesAndSolos(partyGroups, soloMembers, targetCount);
}

// Helper function to combine multiple parties + solos to match exact targetCount
function combinePartiesAndSolos(parties, solos, targetCount) {
  const result = [];
  let found = false;

  function backtrack(start, current) {
    if (found) return;

    const totalSize = current.flat().length;
    if (totalSize === targetCount) {
      result.push(...current.flat());
      found = true;
      return;
    }
    if (totalSize > targetCount) return;

    for (let i = start; i < parties.length; i++) {
      backtrack(i + 1, [...current, parties[i]]);
    }

    if (start === parties.length && totalSize < targetCount) {
      const needed = targetCount - totalSize;
      if (solos.length >= needed) {
        result.push(...solos.slice(0, needed));
        found = true;
      }
    }
  }

  backtrack(0, []);
  return result;
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

async function createMatch(guild, players, teamSize, options = {}) {
  if (!players || players.length === 0) return;

  const totalRequired = teamSize * 2;
  players = getEligiblePlayers(players, totalRequired);
  if (players.length < totalRequired) {
    console.log(`[createMatch] Not enough eligible players (${players.length}/${totalRequired})`);
    return;
  }

  const hex = generateHexCode();
  console.log(`[createMatch] Creating match #${hex} with ${players.length} players.`);

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

    for (let i = 0; i < teams.length; i++) {
      await guild.channels.create({
        name: `#${hex} Team ${i + 1}`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: getPermissionOverwrites(teams[i], PermissionFlagsBits.Connect, false)
      });
    }

    const teamMentions = teams.map(team => team.map(m => `<@${m.id}>`));
    const teamCaptainsMention = await Promise.all(
      captains.map(async id => {
        const mem = await guild.members.fetch(id).catch(() => null);
        return mem ? `<@${id}>` : 'Unknown';
      })
    );

    const partyTips = teamSize >= 3
      ? `\`\`\`\nTips:\n/party create\n/party slot ${teamSize * 2}\n${players.map(p => `/party invite ${p.displayName || p.username}`).join('\n')}\n/host\n\`\`\``
      : '';

    const embeds = [
      {
        title: `Welcome to Match #${hex}`,
        description:
          `Use \`/submit <screenshot> <winbreakername> <topkills> <topkillamount> [losebedbreaker]\` when your game is done.\n\n` +
          `👑 **Team Captains:**\n• Team 1: ${teamCaptainsMention[0]}\n• Team 2: ${teamCaptainsMention[1]}\n\n` +
          `👥 **Teams:**\n• **Team 1:** ${teamMentions[0].join(', ')}\n• **Team 2:** ${teamMentions[1].join(', ')}\n\n` +
          `📜 **Match Rules:**\n• Format: ${rules.format}\n• Map: ${rules.map}\n• Bed Break: ${rules.bedBreakEnabled ? '✅ On' : '❌ Off'}\n• MVP Bonus: ${rules.mvpBonus ? '+10 ELO' : 'No bonus'}\n• Note: ${rules.note}\n\n` +
          `${rules.rulesEmbed || ''}\n${partyTips}`,
        color: 0x00ff00
      }
    ];

    await textChannel.send({ embeds });
    await textChannel.send(players.map(p => `<@${p.id}>`).join(' '));

    await movePlayersToVoiceChannels(guild, teams, category.id);

    const matchData = {
      players: players.map(p => p.id),
      teams: teams.map(t => t.map(p => p.id)),
      captainIds: captains,
      categoryId: category.id,
      textChannelId: textChannel.id,
      status: 'pending',
      rules,
      isPartyMatch: options.isPartyMatch || false
    };

    logMatch(hex, matchData.teams[0], matchData.teams[1]);
    setActiveGame(hex, matchData);

    if (process.env.MATCH_LOGS_ID) {
      await sendLogToStaffChannel(guild.client, guild.id, hex, process.env.MATCH_LOGS_ID);
    }

    console.log(`[createMatch] Match #${hex} setup complete.`);
  } catch (err) {
    console.error(`[createMatch] Failed to create match #${hex}:`, err);
  }
}

function getRulesForMatchType(teamSize) {
  if (teamSize === 3 || teamSize === 4) {
    const section = teamSize === 3 ? _queueRules['3v3'] : _queueRules['4v4'];
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
      map: `Random ${teamSize}v${teamSize} Map`,
      rounds: 1,
      bedBreakEnabled: true,
      mvpBonus: true,
      note: 'Submit results with `/submit`.',
      rulesEmbed: rulesText
    };
  }

  return fallbackRules(teamSize);
}

function fallbackRules(teamSize) {
  return {
    format: teamSize === 1 ? '1v1' : `${teamSize}v${teamSize}`,
    map: `Random ${teamSize}v${teamSize} Map`,
    rounds: 1,
    bedBreakEnabled: true,
    mvpBonus: true,
    note: 'Standard rules apply.',
    rulesEmbed: ''
  };
}

function getPermissionOverwrites(players, permissions, isTextChannel = false) {
  const perms = Array.isArray(permissions) ? permissions : [permissions];
  const overwrites = [];

  const everyoneRoleId = players[0].guild.roles.everyone.id;

  if (isTextChannel) {
    overwrites.push({
      id: everyoneRoleId,
      deny: [PermissionFlagsBits.ViewChannel]
    });
  } else {
    overwrites.push({
      id: everyoneRoleId,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.Connect]
    });
  }

  return overwrites.concat(
    players.map(p => ({
      id: p.id,
      allow: perms
    }))
  );
}

async function movePlayersToVoiceChannels(guild, teams, categoryId) {
  const allChannels = await guild.channels.fetch();
  const voiceChannels = Array.from(allChannels.values())
    .filter(c => c.parentId === categoryId && c.type === ChannelType.GuildVoice)
    .sort((a, b) => a.name.localeCompare(b.name));

  teams.forEach((team, i) => team.forEach(p => p.targetVC = voiceChannels[i]));

  for (const team of teams) {
    for (const p of team) {
      const member = await guild.members.fetch(p.id).catch(() => null);
      if (member && p.targetVC) await member.voice.setChannel(p.targetVC).catch(() => {});
    }
  }
}

function saveActiveGames() {
  fs.writeFileSync(ACTIVE_GAMES_PATH, JSON.stringify(Array.from(_activeGames.entries()), null, 2));
}
function loadActiveGames() {
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
function setActiveGame(gameId, data) {
  _activeGames.set(gameId, data);
  saveActiveGames();
}
function updateActiveGame(gameId, updateData) {
  const match = _activeGames.get(gameId);
  if (!match) return;
  setActiveGame(gameId, { ...match, ...updateData });
}
function deleteActiveGame(gameId) {
  _activeGames.delete(gameId);
  saveActiveGames();
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
  getEligiblePlayers
};
