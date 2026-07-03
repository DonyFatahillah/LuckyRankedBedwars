const queueManager = require('./queueManager');
const Player = require('../models/Player');

module.exports = {
  expectedCount: 6, // 3v3

  /**
   * Handles a 3v3 queue given an array of GuildMember objects.
   * @param {Guild} guild
   * @param {GuildMember[]} members
   */
  async handleQueue(guild, members, eloQueue = null) {
    try {
      console.log('[Queue3v3] handleQueue triggered');

      if (!members || members.length === 0) return;

      // Flatten parties + remove duplicates
      let eligiblePlayers = await queueManager.getEligiblePlayers(members, this.expectedCount);

      console.log(`[Queue3v3] Eligible players: ${eligiblePlayers.length}/${this.expectedCount}`);

      if (eligiblePlayers.length < this.expectedCount) {
        console.log('[Queue3v3] Not enough eligible players to start match.');
        return;
      }

      // Pick first 6 eligible players
      const selectedPlayers = eligiblePlayers.slice(0, this.expectedCount);

      // Create the match
      const captains = await queueManager.createMatch(guild, selectedPlayers, 3, { 
        isPartyMatch: true,
        eloQueue: eloQueue
      });

      if (captains && captains.length === 2) {
        const team1Captain = await Player.load(captains[0]);
        const team2Captain = await Player.load(captains[1]);
        console.log(`[Queue3v3] Team 1 Captain: ${team1Captain.member.displayName} (${team1Captain.elo})`);
        console.log(`[Queue3v3] Team 2 Captain: ${team2Captain.member.displayName} (${team2Captain.elo})`);
      }

    } catch (err) {
      console.error('[Queue3v3] Error handling queue:', err);
    }
  }
};
