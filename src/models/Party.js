class Party {
  constructor(leaderId, maxMembers = 4, saveCallback = null) {
    this.leaderId = leaderId;
    this.members = [leaderId]; // Party always includes the leader
    this.invited = []; // List of user IDs invited to the party
    this.maxMembers = maxMembers;
    this.autowarp = true; // ✅ Auto-follow is enabled by default
    this.public = false; // ✅ New: privacy flag (false = private, true = public)
    this.createdAt = Date.now(); // ✅ New: for timestamp in embed
    this._save = saveCallback;
  }

  setSaveCallback(saveFn) {
    this._save = saveFn;
  }

  _commit() {
    if (typeof this._save === 'function') this._save();
  }

  invite(userId) {
    if (this.isMember(userId) || this.invited.includes(userId)) return false;
    if (this.members.length + this.invited.length >= this.maxMembers) return false;
    this.invited.push(userId);
    this._commit();
    return true;
  }

  uninvite(userId) {
    this.invited = this.invited.filter(id => id !== userId);
    this._commit();
  }

  addMember(userId) {
    if (!this.public && !this.invited.includes(userId)) return false;
    if (this.isMember(userId)) return false;
    if (this.members.length >= this.maxMembers) return false;
    this.invited = this.invited.filter(id => id !== userId);
    this.members.push(userId);
    this._commit();
    return true;
  }

  removeMember(userId) {
    this.members = this.members.filter(id => id !== userId);
    this._commit();
    return this.members.length > 0;
  }

  promoteNewLeader(newLeaderId) {
    if (this.isMember(newLeaderId)) {
      this.leaderId = newLeaderId;
      this._commit();
      return true;
    }
    return false;
  }

  isMember(userId) {
    return this.members.includes(userId);
  }

  isLeader(userId) {
    return this.leaderId === userId;
  }

  setAutoWarp(state) {
    this.autowarp = Boolean(state);
    this._commit();
  }

  setPublic(state) {
    this.public = Boolean(state);
    this._commit();
  }

  get size() {
    return this.members.length;
  }

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
