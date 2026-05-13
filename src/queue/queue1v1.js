
const path = require('path');
const queueManager = require(path.join(__dirname, 'queueManager'));

module.exports = {
  expectedCount: 2, // 1v1

  async handleQueue(guild, members, config = null) {
    console.log('[Queue1v1] handleQueue triggered');
    
    // Use prioritization logic
    const players = queueManager.getEligiblePlayers([...members.values()], 2);

    if (players.length < 2) {
      console.log('[Queue1v1] Not enough eligible players.');
      return;
    }

    console.log('[Queue1v1] Players selected:', players.map(p => p.user.tag).join(', '));

    // Call shared match logic
    await queueManager.createMatch(guild, players, 1, { eloQueue: config }); // 1 player per team
  }
};
