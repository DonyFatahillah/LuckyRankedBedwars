const queueManager = require('./queueManager');
const Player = require('../models/Player');

module.exports = {
  expectedCount: 4, // 2v2

  /**
   * Handles a 2v2 queue given an array of GuildMember objects.
   * @param {Guild} guild
   * @param {GuildMember[]} members
   */
  async handleQueue(guild, members, eloQueue = null) {
    try {
      console.log('[Queue2v2] handleQueue triggered');

      if (!members || members.length === 0) return;

      // Flatten parties + remove duplicates
      let eligiblePlayers = await queueManager.getEligiblePlayers(members, this.expectedCount, 2);

      console.log(`[Queue2v2] Eligible players: ${eligiblePlayers.length}/${this.expectedCount}`);

      if (eligiblePlayers.length < this.expectedCount) {
        console.log('[Queue2v2] Not enough eligible players to start match.');
        return;
      }

      // Pick first 4 eligible players
      const selectedPlayers = eligiblePlayers.slice(0, this.expectedCount);

      // Create the match
      const captains = await queueManager.createMatch(guild, selectedPlayers, 2, {
        isPartyMatch: true,
        eloQueue: eloQueue
      });

      if (captains && captains.length === 2) {
        const team1Captain = await Player.load(await guild.members.fetch(captains[0]));
        const team2Captain = await Player.load(await guild.members.fetch(captains[1]));
        console.log(`[Queue2v2] Team 1 Captain: ${team1Captain.member.displayName} (${team1Captain.elo})`);
        console.log(`[Queue2v2] Team 2 Captain: ${team2Captain.member.displayName} (${team2Captain.elo})`);
      }

    } catch (err) {
      console.error('[Queue2v2] Error handling queue:', err);
    }
  }
};
