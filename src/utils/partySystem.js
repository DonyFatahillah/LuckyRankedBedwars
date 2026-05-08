// src/utils/partySystem.js
const fs = require('fs');
const path = require('path');
const Party = require('../models/Party');
const PartyModel = require('../models/PartySchema');

const PARTY_FILE = path.join(__dirname, '../../data/parties.json');
const PARTY_MODE_FILE = path.join(__dirname, '../../data/partyMatch.json');

let parties = new Map();
let partyMode = false;
const DEFAULT_MAX_MEMBERS = 2;

// -------------------------
// Party Mode (global toggle)
// -------------------------
function loadPartyMode() {
  try {
    if (fs.existsSync(PARTY_MODE_FILE)) {
      partyMode = JSON.parse(fs.readFileSync(PARTY_MODE_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('[PartySystem] Failed to load party mode state:', err);
    partyMode = false;
  }
}

async function setPartyMode(state) {
  partyMode = Boolean(state);
  try {
    await fs.promises.writeFile(PARTY_MODE_FILE, JSON.stringify(partyMode, null, 2), 'utf-8');
  } catch (err) {
    console.error('[PartySystem] Failed to save party mode state:', err);
  }
}

function isPartyMode() {
  return partyMode;
}

// -------------------------
// Party Manager
// -------------------------
async function loadParties() {
  if (!fs.existsSync(PARTY_FILE)) return;

  try {
    const raw = fs.readFileSync(PARTY_FILE, 'utf-8');
    const data = JSON.parse(raw);
    for (const leaderId in data) {
      const rawParty = data[leaderId];
      const p = new Party(
        rawParty.leaderId,
        rawParty.maxMembers || DEFAULT_MAX_MEMBERS
      );
      p.members = rawParty.members;
      p.invited = rawParty.invited;
      p.autowarp = rawParty.autowarp ?? true;
      p.public = rawParty.public ?? false;
      p.createdAt = rawParty.createdAt ?? Date.now();
      parties.set(leaderId, p);
    }
    console.log(`[PartySystem] Loaded ${parties.size} parties from JSON.`);
  } catch (err) {
    console.error('[PartySystem] Failed to load parties from JSON:', err);
    parties = new Map();
  }
}

async function saveParties(leaderId = null) {
  const obj = {};
  for (const [lId, party] of parties.entries()) {
    obj[lId] = party.toJSON();
  }
  try {
    fs.writeFileSync(PARTY_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('[PartySystem] Failed to save parties to JSON:', err);
  }

  // MongoDB Sync
  if (leaderId) {
    const party = parties.get(leaderId);
    try {
      if (party) {
        await PartyModel.findOneAndUpdate(
          { leaderId },
          {
            leaderId,
            members: party.members,
            createdAt: party.createdAt
          },
          { upsert: true }
        );
      } else {
        await PartyModel.deleteOne({ leaderId });
      }
    } catch (err) {
      console.error(`[PartySystem-Mongo] Failed to sync party #${leaderId}:`, err);
    }
  }
}

// 🔧 Removes a user from all parties and invited lists
async function removeFromAllParties(userId) {
  for (const [leaderId, party] of parties.entries()) {
    if (party.members.includes(userId)) {
      party.members = party.members.filter(id => id !== userId);
      if (party.leaderId === userId || party.members.length === 0) {
        parties.delete(leaderId);
        await PartyModel.deleteOne({ leaderId }).catch(() => {});
        continue;
      }
      await saveParties(leaderId);
    }
    party.invited = party.invited.filter(id => id !== userId);
  }
}

// Create a new party
async function createParty(leaderId, maxMembers = DEFAULT_MAX_MEMBERS) {
  if (getPartyByUser(leaderId)) return null;
  await removeFromAllParties(leaderId);

  const party = new Party(leaderId, maxMembers);
  party.createdAt = Date.now();
  parties.set(leaderId, party);
  await saveParties(leaderId);
  console.log(`[PartySystem] Created new party for leader ${leaderId}`);
  return party;
}

async function disbandParty(leaderId) {
  const success = parties.delete(leaderId);
  if (success) {
    console.log(`[PartySystem] Disbanded party of leader ${leaderId}`);
    try {
      fs.writeFileSync(PARTY_FILE, JSON.stringify(Object.fromEntries(
        Array.from(parties.entries()).map(([k, v]) => [k, v.toJSON()])
      ), null, 2));
      await PartyModel.deleteOne({ leaderId });
    } catch (err) {
      console.error(`[PartySystem] Error during disbanding party ${leaderId}:`, err);
    }
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
  await PartyModel.deleteOne({ leaderId: oldLeaderId }).catch(() => {});

  parties.set(party.leaderId, party);
  await saveParties(party.leaderId);
  
  console.log(`[PartySystem] Promoted ${newLeaderId} as new leader (was ${currentLeaderId})`);
  return true;
}

// Invite a user
async function inviteToParty(leaderId, targetId) {
  const party = getPartyByLeader(leaderId);
  if (!party) return false;
  if (party.size >= party.maxMembers) return false;

  await removeFromAllParties(targetId);

  const success = party.invite(targetId);
  if (success) {
    console.log(`[PartySystem] Invited ${targetId} to party of ${leaderId}`);
    await saveParties(leaderId);
  }
  return success;
}

// Accept an invite
async function acceptInvite(userId, leaderId) {
  const party = getPartyByLeader(leaderId);
  if (!party) return false;
  if (!party.invited.includes(userId)) return false;
  if (party.size >= party.maxMembers) return false;

  // Remove from invited and add to members
  party.invited = party.invited.filter(id => id !== userId);
  party.members.push(userId);

  console.log(`[PartySystem] ${userId} joined the party of ${leaderId}`);
  await saveParties(leaderId);
  return true;
}

// -------------------------
// Queue helpers
// -------------------------
function getEligibleParty(userId, teamSize) {
  if (!isPartyMode()) return null;

  const party = getPartyByUser(userId);
  if (!party) return null;

  if (party.size > teamSize) return null;

  return party.members; 
}

// Debug
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
// loadParties is async now, should be handled in index.js startup

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
