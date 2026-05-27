// src/utils/partyHelper.js
const partySystem = require('./partySystem');

/**
 * Picks players from a queue to fill a match, respecting parties.
 * Parties are selected as a whole, if they fit in the remaining slots.
 *
 * @param {Array} players - Array of Discord Member objects in the queue
 * @param {number} teamSize - Total number of players needed for the match
 * @returns {Array} Selected players for the match
 */
function pickPlayersFromQueue(players, teamSize) {
  const selected = [];
  const usedPartyLeaders = new Set();

  for (const player of players) {
    // Check if player is already included
    if (selected.find(p => p.id === player.id)) continue;

    const party = partySystem.getPartyByUser(player.id);

    if (party && !usedPartyLeaders.has(party.leaderId)) {
      // Include party only if it fits in remaining slots
      if (selected.length + party.members.length <= teamSize) {
        // Add all party members (fetching full Member objects)
        selected.push(...party.members.map(id => players.find(p => p.id === id) || { id }));
        usedPartyLeaders.add(party.leaderId);
      }
    } else if (!party) {
      // Individual player, no party
      selected.push(player);
    }

    if (selected.length >= teamSize) break;
  }

  // Return only the exact team size
  return selected.slice(0, teamSize);
}

/**
 * Checks if a player is in a party that fits within a team size.
 * Returns the members of the party if eligible, else null.
 */
async function getEligiblePartyMembers(userId, teamSize) {
  const partyMembers = await partySystem.getEligibleParty(userId, teamSize);
  return partyMembers || [userId];
}

module.exports = { pickPlayersFromQueue, getEligiblePartyMembers };
