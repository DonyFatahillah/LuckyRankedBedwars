const BaseQueueType = require('./BaseQueueType');
const { createMatch } = require('../queueManager');

class OneVsOneType extends BaseQueueType {
    async handleQueue(guild, members) {
        // Logic for 1v1 specifically
        await createMatch(guild, members, 1, { queueType: '1v1' });
    }
}

module.exports = new OneVsOneType();
