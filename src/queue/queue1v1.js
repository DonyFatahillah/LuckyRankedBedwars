
const path = require('path');
const queueManager = require(path.join(__dirname, 'queueManager'));

module.exports = {
  expectedCount: 2, // 1v1

  async handleQueue(guild, members) {
    console.log('[Queue1v1] handleQueue triggered');
    console.log('[Queue1v1] queueManager:', typeof queueManager.createMatch);

    // Pick exactly 2 members randomly
    const players = Array.from(members.values())
      .sort(() => 0.5 - Math.random())
      .slice(0, 2);

    console.log('[Queue1v1] Players selected:', players.map(p => p.user.tag).join(', '));

    // Call shared match logic
    await queueManager.createMatch(guild, players, 1); // 1 player per team
  }
};
