const { getPartyByUser, getPartyByLeader } = require('../utils/partySystem');

module.exports = {
  name: 'voiceStateUpdate',

  async execute(oldState, newState) {
    const userId = newState.id;

    const FROZEN_ROLE_ID = process.env.FROZEN_ROLE_ID;

    // 🛑 Ignore if user has frozen role
    const memberRoles = newState.member?.roles?.cache;
    if (memberRoles?.has(FROZEN_ROLE_ID)) return;

    // 🧠 1. Is this user a party leader?
    const leaderParty = getPartyByLeader(userId);
    if (
      leaderParty &&
      leaderParty.autowarp && // ✅ AutoWarp must be ON
      newState.channelId &&
      oldState.channelId !== newState.channelId
    ) {
      // 🎯 Leader moved — move all members who are in a VC
      for (const memberId of leaderParty.members) {
        if (memberId === userId) continue; // Skip leader

        const member = newState.guild.members.cache.get(memberId);
        if (!member?.voice?.channel) continue; // Skip if not in VC
        if (member.roles.cache.has(FROZEN_ROLE_ID)) continue; // Skip frozen members

        try {
          await member.voice.setChannel(newState.channelId);
          console.log(`[AutoWarp] Moved ${member.displayName} to follow leader ${newState.member.displayName}`);
        } catch (err) {
          console.warn(`[AutoWarp] Failed to move ${member.displayName}: ${err.message}`);
        }
      }
    }

    // 🧠 2. Is this user a party member (not leader)?
    const userParty = getPartyByUser(userId);

    if (
      userParty &&
      userParty.autowarp && // ✅ AutoWarp must be ON
      !userParty.isLeader(userId) &&
      newState.channelId &&
      oldState.channelId !== newState.channelId
    ) {
      const leader = newState.guild.members.cache.get(userParty.leaderId);

      // 🛑 If leader not in VC or user somehow left party
      if (!leader || !leader.voice?.channel || !userParty.members.includes(userId)) return;

      // 🎯 Member moved manually → re-sync back to leader’s VC
      try {
        await newState.member.voice.setChannel(leader.voice.channelId);
        console.log(`[AutoWarp] Synced ${newState.member.displayName} back to leader ${leader.displayName}`);
      } catch (err) {
        console.warn(`[AutoWarp] Failed to sync ${newState.member.displayName} to leader: ${err.message}`);
      }
    }
  }
};
