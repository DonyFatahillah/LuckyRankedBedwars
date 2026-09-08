// src/utils/partySystem.js
const { redis } = require('./redisClient');
const Party = require('../models/Party');
const PartyModel = require('../models/PartySchema');

let parties = new Map();
const { isPartyMatch, setPartyMatch } = require('./partyModeManager');

// -------------------------
// Party Mode (global toggle)
// -------------------------
async function setPartyMode(state) {
  await setPartyMatch(state);
}

async function isPartyMode() {
  return await isPartyMatch();
}

// -------------------------
// Party Manager
// -------------------------
async function loadParties() {
  try {
    const keys = await redis.keys('party:*');
    for (const key of keys) {
      if (key === 'party:mode') continue;
      const raw = await redis.get(key);
      const rawParty = JSON.parse(raw);
      
      const p = new Party(rawParty);
      parties.set(rawParty.leaderId, p);
    }
    console.log(`[PartySystem] Loaded ${parties.size} parties from Redis.`);
  } catch (err) {
    console.error('[PartySystem] Failed to load parties from Redis:', err);
    parties = new Map();
  }
}

async function saveParties(leaderId = null) {
  if (leaderId) {
    const party = parties.get(leaderId);
    if (party) {
      await redis.set(`party:${leaderId}`, JSON.stringify(party.toJSON()));
      
      // Sync to MongoDB
      try {
        await PartyModel.findOneAndUpdate(
          { leaderId },
          { leaderId, members: party.members, createdAt: party.createdAt },
          { upsert: true }
        );
      } catch (err) {
        console.error(`[PartySystem-Mongo] Failed to sync party #${leaderId}:`, err);
      }
    } else {
      await redis.del(`party:${leaderId}`);
      await PartyModel.deleteOne({ leaderId }).catch(() => {});
    }
  }
}

async function removeFromAllParties(userId) {
  const saveTasks = [];
  
  for (const [leaderId, party] of parties.entries()) {
    let modified = false;

    if (party.members.includes(userId)) {
      party.members = party.members.filter(id => id !== userId);
      if (party.leaderId === userId || party.members.length === 0) {
        parties.delete(leaderId);
        saveTasks.push(redis.del(`party:${leaderId}`));
        saveTasks.push(PartyModel.deleteOne({ leaderId }).catch(() => {}));
        continue;
      }
      modified = true;
    }

    if (party.invited.includes(userId)) {
      party.invited = party.invited.filter(id => id !== userId);
      modified = true;
    }

    if (modified) {
      saveTasks.push(saveParties(leaderId));
    }
  }

  await Promise.all(saveTasks);
}

async function createParty(leaderId, maxMembers = null) {
  if (maxMembers === null) {
    try {
      const fs = require('fs');
      const path = require('path');
      const limitPath = path.join(__dirname, '../../data/partylimit.json');
      const limitData = JSON.parse(fs.readFileSync(limitPath, 'utf-8'));
      maxMembers = limitData.limit || 4;
    } catch (err) {
      maxMembers = 4;
    }
  }

  if (getPartyByUser(leaderId)) return null;
  await removeFromAllParties(leaderId);

  const party = new Party({ leaderId, maxMembers });
  party.createdAt = Date.now();
  parties.set(leaderId, party);
  await saveParties(leaderId);
  return party;
}

async function disbandParty(leaderId) {
  const success = parties.delete(leaderId);
  if (success) {
    await redis.del(`party:${leaderId}`);
    await PartyModel.deleteOne({ leaderId }).catch(() => {});
  }
  return success;
}

function getPartyByUser(userId) {
  for (const party of parties.values()) {
    if (party.isMember(userId)) return party;
  }
  return null;
}

function getPartyByLeader(leaderId) {
  return parties.get(leaderId);
}

async function leaveParty(userId) {
  const party = getPartyByUser(userId);
  if (!party) return false;

  const wasLeader = party.isLeader(userId);
  const hasMembersLeft = party.removeMember(userId);

  if (!hasMembersLeft || wasLeader) {
    await disbandParty(party.leaderId);
    return 'disbanded';
  }

  await saveParties(party.leaderId);
  return 'left';
}

async function promoteLeader(currentLeaderId, newLeaderId) {
  const party = getPartyByLeader(currentLeaderId);
  if (!party || !party.isMember(newLeaderId)) return false;

  const oldLeaderId = party.leaderId;
  party.promoteNewLeader(newLeaderId);
  
  parties.delete(oldLeaderId);
  await redis.del(`party:${oldLeaderId}`);
  await PartyModel.deleteOne({ leaderId: oldLeaderId }).catch(() => {});

  parties.set(party.leaderId, party);
  await saveParties(party.leaderId);
  return true;
}

async function inviteToParty(leaderId, targetId) {
  const party = getPartyByLeader(leaderId);
  if (!party || party.size >= party.maxMembers) return false;

  await removeFromAllParties(targetId);
  const success = party.invite(targetId);
  if (success) await saveParties(leaderId);
  return success;
}

async function acceptInvite(userId, leaderId) {
  const party = getPartyByLeader(leaderId);
  if (!party || !party.invited.includes(userId) || party.size >= party.maxMembers) return false;

  party.invited = party.invited.filter(id => id !== userId);
  party.members.push(userId);
  await saveParties(leaderId);
  return true;
}

async function getEligibleParty(userId, teamSize) {
  if (!(await isPartyMode())) return null;
  const party = getPartyByUser(userId);
  if (!party || party.size > teamSize) return null;
  return party.members; 
}

function getAllParties() {
  return Array.from(parties.values());
}

function listParties() {
  return Array.from(parties.entries()).map(([leaderId, party]) => ({
    leaderId,
    members: party.members,
    invited: party.invited,
    maxMembers: party.maxMembers
  }));
}

// -------------------------
// Init
// -------------------------

module.exports = {
  isPartyMode,
  setPartyMode,
  createParty,
  disbandParty,
  getPartyByUser,
  getPartyByLeader,
  leaveParty,
  promoteLeader,
  inviteToParty,
  acceptInvite,
  listParties,
  getAllParties,
  loadParties,
  saveParties,
  getEligibleParty
};
