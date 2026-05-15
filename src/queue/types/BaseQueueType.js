// src/queue/types/BaseQueueType.js
class BaseQueueType {
    async handleQueue(guild, members) {
        throw new Error('Not implemented');
    }
}

module.exports = BaseQueueType;
