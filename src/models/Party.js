const PartyModel = require('./PartySchema');
const { redis } = require('../utils/redisClient');

class Party {
  constructor(data) {
    this.leaderId = data.leaderId;
    this.members = data.members || [data.leaderId];
    this.invited = data.invited || [];
    this.maxMembers = data.maxMembers || 2;
    this.autowarp = data.autowarp ?? true;
    this.public = data.public ?? false;
    this.createdAt = data.createdAt || Date.now();
  }

  static async load(leaderId) {
    let data = await redis.get(`party:${leaderId}`);
    if (data) return new Party(JSON.parse(data));

    const doc = await PartyModel.findOne({ leaderId });
    if (doc) {
      const party = new Party(doc);
      await party.cache();
      return party;
    }
    return null;
  }

  async cache() {
    await redis.set(`party:${this.leaderId}`, JSON.stringify(this.toJSON()));
  }

  async save() {
    await this.cache();
    await PartyModel.findOneAndUpdate(
      { leaderId: this.leaderId },
      { ...this.toJSON() },
      { upsert: true }
    );
  }

  async delete() {
    await redis.del(`party:${this.leaderId}`);
    await PartyModel.deleteOne({ leaderId: this.leaderId });
  }

  // --- Logic Methods ---
  invite(userId) {
    if (this.isMember(userId) || this.invited.includes(userId)) return false;
    if (this.members.length + this.invited.length >= this.maxMembers) return false;
    this.invited.push(userId);
    return true;
  }

  addMember(userId) {
    if (!this.public && !this.invited.includes(userId)) return false;
    if (this.isMember(userId) || this.members.length >= this.maxMembers) return false;
    this.invited = this.invited.filter(id => id !== userId);
    this.members.push(userId);
    return true;
  }

  removeMember(userId) {
    this.members = this.members.filter(id => id !== userId);
    return this.members.length > 0;
  }

  promoteNewLeader(newLeaderId) {
    if (this.isMember(newLeaderId)) {
      this.leaderId = newLeaderId;
      return true;
    }
    return false;
  }

  isMember(userId) { return this.members.includes(userId); }
  isLeader(userId) { return this.leaderId === userId; }

  toJSON() {
    return {
      leaderId: this.leaderId,
      members: this.members,
      invited: this.invited,
      maxMembers: this.maxMembers,
      autowarp: this.autowarp,
      public: this.public,
      createdAt: this.createdAt
    };
  }
}

module.exports = Party;
