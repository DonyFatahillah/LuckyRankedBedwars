const queueManager = require('./queueManager');
const Player = require('../models/Player');

module.exports = {
  expectedCount: 6, // 3v3

  /**
   * Handles a 3v3 queue given an array of GuildMember objects.
   * @param {Guild} guild
   * @param {GuildMember[]} members
   */
  async handleQueue(guild, members) {
    try {
      console.log('[Queue3v3] handleQueue triggered');

      if (!members || members.length === 0) return;

      // Flatten parties + remove duplicates
      let eligiblePlayers = queueManager.getEligiblePlayers(members, this.expectedCount);

      console.log(`[Queue3v3] Eligible players: ${eligiblePlayers.length}/${this.expectedCount}`);

      if (eligiblePlayers.length < this.expectedCount) {
        console.log('[Queue3v3] Not enough eligible players to start match.');
        return;
      }

      // Pick first 6 eligible players
      const selectedPlayers = eligiblePlayers.slice(0, this.expectedCount);

      // Create the match
      await queueManager.createMatch(guild, selectedPlayers, 3, { isPartyMatch: true });

      // Split into teams
      const team1 = selectedPlayers.slice(0, 3);
      const team2 = selectedPlayers.slice(3, 6);

      // Find captains by highest ELO
      const [team1Captain, team2Captain] = await Promise.all([
        findTeamCaptain(team1),
        findTeamCaptain(team2)
      ]);

      console.log(`[Queue3v3] Team 1 Captain: ${team1Captain.member.displayName} (${team1Captain.elo})`);
      console.log(`[Queue3v3] Team 2 Captain: ${team2Captain.member.displayName} (${team2Captain.elo})`);

    } catch (err) {
      console.error('[Queue3v3] Error handling queue:', err);
    }
  }
};

// Helper: find highest ELO player in team
async function findTeamCaptain(teamMembers) {
  const players = await Promise.all(teamMembers.map(m => new Player(m)));
  return players.reduce((top, p) => (p.elo > top.elo ? p : top), players[0]);
}
