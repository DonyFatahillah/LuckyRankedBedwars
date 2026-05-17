// src/utils/partySystem.js
const { redis } = require('./redisClient');
const Party = require('../models/Party');
const PartyModel = require('../models/PartySchema');

let parties = new Map();
let partyMode = false;
const DEFAULT_MAX_MEMBERS = 2;

// -------------------------
// Party Mode (global toggle)
// -------------------------
async function loadPartyMode() {
  try {
    const mode = await redis.get('party:mode');
    partyMode = mode === 'true';
  } catch (err) {
    console.error('[PartySystem] Failed to load party mode from Redis:', err);
    partyMode = false;
  }
}

async function setPartyMode(state) {
  partyMode = Boolean(state);
  try {
    await redis.set('party:mode', partyMode);
  } catch (err) {
    console.error('[PartySystem] Failed to save party mode to Redis:', err);
  }
}

function isPartyMode() {
  return partyMode;
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
  for (const [leaderId, party] of parties.entries()) {
    if (party.members.includes(userId)) {
      party.members = party.members.filter(id => id !== userId);
      if (party.leaderId === userId || party.members.length === 0) {
        parties.delete(leaderId);
        await redis.del(`party:${leaderId}`);
        await PartyModel.deleteOne({ leaderId }).catch(() => {});
        continue;
      }
      await saveParties(leaderId);
    }
    party.invited = party.invited.filter(id => id !== userId);
    await saveParties(leaderId);
  }
}

async function createParty(leaderId, maxMembers = DEFAULT_MAX_MEMBERS) {
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

function getEligibleParty(userId, teamSize) {
  if (!isPartyMode()) return null;
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
loadPartyMode();

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
