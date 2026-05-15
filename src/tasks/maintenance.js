const { cleanupExpiredPunishments } = require('../utils/punishmentManager');
const { checkAllQueueChannelsOnStartup } = require('../queue/queueManager');

module.exports = {
  name: 'maintenance',
  async execute(client) {
    console.log('[Tasks] Running maintenance tasks...');
    
    // Cleanup expired punishments
    await cleanupExpiredPunishments(client);
    setInterval(() => cleanupExpiredPunishments(client), 30 * 60 * 1000); // 30 mins

    // Queue channel checks
    await checkAllQueueChannelsOnStartup(client);
  }
};
