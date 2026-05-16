const queueManager = require('./queueManager');
const Player = require('../models/Player');

module.exports = {
  expectedCount: 8, // 4v4

  /**
   * Handles a 4v4 queue given an array of GuildMember objects.
   * @param {Guild} guild
   * @param {GuildMember[]} members
   */
  async handleQueue(guild, members, eloQueue = null) {
    try {
      console.log('[Queue4v4] handleQueue triggered');

      if (!members || members.length === 0) return;

      // Flatten parties + remove duplicates
      let eligiblePlayers = queueManager.getEligiblePlayers(members, this.expectedCount);

      console.log(`[Queue4v4] Eligible players: ${eligiblePlayers.length}/${this.expectedCount}`);

      if (eligiblePlayers.length < this.expectedCount) {
        console.log('[Queue4v4] Not enough eligible players to start match.');
        return;
      }

      // Pick first 8 eligible players
      const selectedPlayers = eligiblePlayers.slice(0, this.expectedCount);

      // Create the match
      await queueManager.createMatch(guild, selectedPlayers, 4, { 
        isPartyMatch: true,
        eloQueue: eloQueue
      });

      // Split into teams
      const team1 = selectedPlayers.slice(0, 4);
      const team2 = selectedPlayers.slice(4, 8);

      // Find captains by highest ELO
      const [team1Captain, team2Captain] = await Promise.all([
        findTeamCaptain(team1),
        findTeamCaptain(team2)
      ]);

      console.log(`[Queue4v4] Team 1 Captain: ${team1Captain.member.displayName} (${team1Captain.elo})`);
      console.log(`[Queue4v4] Team 2 Captain: ${team2Captain.member.displayName} (${team2Captain.elo})`);

    } catch (err) {
      console.error('[Queue4v4] Error handling queue:', err);
    }
  }
};

// Helper: find highest ELO player in team
async function findTeamCaptain(teamMembers) {
  const players = await Promise.all(teamMembers.map(m => Player.load(m)));
  return players.reduce((top, p) => (p.elo > top.elo ? p : top), players[0]);
}
