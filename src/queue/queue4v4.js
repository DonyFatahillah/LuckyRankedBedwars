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
      let eligiblePlayers = await queueManager.getEligiblePlayers(members, this.expectedCount);

      console.log(`[Queue4v4] Eligible players: ${eligiblePlayers.length}/${this.expectedCount}`);

      if (eligiblePlayers.length < this.expectedCount) {
        console.log('[Queue4v4] Not enough eligible players to start match.');
        return;
      }

      // Pick first 8 eligible players
      const selectedPlayers = eligiblePlayers.slice(0, this.expectedCount);

      // Create the match
      const captains = await queueManager.createMatch(guild, selectedPlayers, 4, { 
        isPartyMatch: true,
        eloQueue: eloQueue
      });

      if (captains && captains.length === 2) {
        const team1Captain = await Player.load(captains[0]);
        const team2Captain = await Player.load(captains[1]);
        console.log(`[Queue4v4] Team 1 Captain: ${team1Captain.member.displayName} (${team1Captain.elo})`);
        console.log(`[Queue4v4] Team 2 Captain: ${team2Captain.member.displayName} (${team2Captain.elo})`);
      }

    } catch (err) {
      console.error('[Queue4v4] Error handling queue:', err);
    }
  }
};
