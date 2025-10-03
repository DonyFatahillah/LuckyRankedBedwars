// src/utils/partySystem.js
const fs = require('fs');
const path = require('path');
const Party = require('../models/Party');

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
function loadParties() {
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
  } catch (err) {
    console.error('[PartySystem] Failed to load parties:', err);
    parties = new Map();
  }
}

function saveParties() {
  const obj = {};
  for (const [leaderId, party] of parties.entries()) {
    obj[leaderId] = party.toJSON();
  }
  try {
    fs.writeFileSync(PARTY_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('[PartySystem] Failed to save parties:', err);
  }
}


// Create a new party with optional maxMembers
function createParty(leaderId, maxMembers = DEFAULT_MAX_MEMBERS) {
  if (getPartyByUser(leaderId)) return null;
  const party = new Party(leaderId, maxMembers);
  party.createdAt = Date.now(); // ✅ set creation timestamp
  parties.set(leaderId, party);
  saveParties();
  console.log(`[PartySystem] Created new party for leader ${leaderId}`);
  return party;
}
function disbandParty(leaderId) {
  const success = parties.delete(leaderId);
  if (success) {
    console.log(`[PartySystem] Disbanded party of leader ${leaderId}`);
    saveParties();
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
  const party = parties.get(leaderId);
  if (party) {
    console.log(`[PartySystem] getPartyByLeader → ${leaderId} is still a leader`);
  }
  return party;
}

function leaveParty(userId) {
  const party = getPartyByUser(userId);
  if (!party) return false;

  const wasLeader = party.isLeader(userId);
  const hasMembersLeft = party.removeMember(userId);

  if (!hasMembersLeft) {
    disbandParty(party.leaderId);
    return 'disbanded';
  }

  if (wasLeader) {
    disbandParty(party.leaderId);
    return 'disbanded';
  }

  saveParties();
  return 'left';
}

function promoteLeader(currentLeaderId, newLeaderId) {
  const party = getPartyByLeader(currentLeaderId);
  if (!party || !party.isMember(newLeaderId)) return false;

  party.promoteNewLeader(newLeaderId);
  parties.delete(currentLeaderId);
  parties.set(party.leaderId, party);
  saveParties();
  console.log(`[PartySystem] Promoted ${newLeaderId} as new leader (was ${currentLeaderId})`);
  return true;
}

// Invite a user (respects maxMembers)
function inviteToParty(leaderId, targetId) {
  const party = getPartyByLeader(leaderId);
  if (!party) return false;

  if (party.size >= party.maxMembers) return false; // Can't invite, party full

  const success = party.invite(targetId);
  if (success) {
    console.log(`[PartySystem] Invited ${targetId} to party of ${leaderId}`);
    saveParties();
  }
  return success;
}

// Accept an invite (respects maxMembers)
function acceptInvite(userId, leaderId) {
  const party = getPartyByLeader(leaderId);
  if (!party) return false;

  if (party.size >= party.maxMembers) return false; // Can't join, party full

  const success = party.addMember(userId);
  if (success) {
    console.log(`[PartySystem] ${userId} joined the party of ${leaderId}`);
    saveParties();
  }
  return success;
}

// -------------------------
// Queue helpers
// -------------------------
function getEligibleParty(userId, teamSize) {
  if (!isPartyMode()) return null;

  const party = getPartyByUser(userId);
  if (!party) return null;

  // Only include parties that fit within the team size
  if (party.size > teamSize) return null;

  return party.members;
}

// Debug function (optional but useful)
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
loadParties();

module.exports = {
  // Party mode
  isPartyMode,
  setPartyMode,
  // Party manager
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
  // Queue helper
  getEligibleParty
};
