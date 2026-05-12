// src/utils/voiceJoinTracker.js
const joinTimes = new Map();

function trackJoin(userId) {
  if (!joinTimes.has(userId)) {
    joinTimes.set(userId, Date.now());
    // console.log(`[VoiceJoinTracker] Tracked join for ${userId}`);
  }
}

function trackLeave(userId) {
  joinTimes.delete(userId);
  // console.log(`[VoiceJoinTracker] Tracked leave for ${userId}`);
}

function getJoinTime(userId) {
  return joinTimes.get(userId) || Infinity;
}

module.exports = {
  trackJoin,
  trackLeave,
  getJoinTime
};
