require('dotenv').config();

module.exports = [
  {
    range: [0, 600],
    type: '3v3',
    minElo: 0,
    maxElo: 600,
    voiceChannelId: process.env.QUEUE_0_600_3V3_ELO_VOICE_ID,
    isPlayerPicking: false,
    isArenaPicking: false
  },
  {
    range: [0, 600],
    type: '4v4',
    minElo: 0,
    maxElo: 600,
    voiceChannelId: process.env.QUEUE_0_600_4V4_ELO_VOICE_ID,
    isPlayerPicking: false,
    isArenaPicking: false
  },
  {
    range: [600, Infinity],
    type: '3v3',
    minElo: 600,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_600_PLUS_3V3_ELO_VOICE_ID,
    isPlayerPicking: true,
    isArenaPicking: true
  },
  {
    range: [600, Infinity],
    type: '4v4',
    minElo: 600,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_600_PLUS_4V4_ELO_VOICE_ID,
    isPlayerPicking: true,
    isArenaPicking: true
  },
  {
    range: [0, Infinity],
    type: '4v4',
    minElo: 0,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_ALL_RANK_4V4_ID,
    isPlayerPicking: true,
    isArenaPicking: true
  },
  {
    range: [0, Infinity],
    type: '3v3',
    minElo: 0,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_ALL_RANK_3V3_ID,
    isPlayerPicking: true,
    isArenaPicking: true
  },
  {
    range: [0, Infinity],
    type: '4v4',
    minElo: 0,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_PREMIUM_VOICE_ID,
    requiredRoleId: [process.env.PREMIUM_ROLE_ID, process.env.PUGS_ROLE_ID, process.env.PITS_ROLE_ID, process.env.PUPS_ROLE_ID, process.env.STAFF_ROLE_ID],
    isPlayerPicking: true,
    isArenaPicking: true
  },
  // Debug doubles queues: the plugin reads redisQueueType and maps the teams
  // (2v2_CROSS = red vs aqua cross-layout map, 2v2_SIDE = red vs blue side-layout map).
  // Parties stay together, solos are randomized, then everyone votes from maps_2v2.
  {
    range: [0, Infinity],
    type: '2v2',
    redisQueueType: '2v2_CROSS',
    minElo: 0,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_2V2_CROSS_DEBUG_VOICE_ID,
    isDebug: true,
    isPlayerPicking: false,
    isArenaPicking: true
  },
  {
    range: [0, Infinity],
    type: '2v2',
    redisQueueType: '2v2_SIDE',
    minElo: 0,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_2V2_SIDE_DEBUG_VOICE_ID,
    isDebug: true,
    isPlayerPicking: false,
    isArenaPicking: true
  },
  ];

function isAllRankQueue(channelId) {
  const queue = module.exports.find(q => q.voiceChannelId === channelId);
  return queue && queue.minElo === 0 && queue.maxElo === Infinity;
}

function isPlayerPicking(channelId) {
  const queue = module.exports.find(q => q.voiceChannelId === channelId);
  return queue ? !!queue.isPlayerPicking : false;
}

function isArenaPicking(channelId) {
  const queue = module.exports.find(q => q.voiceChannelId === channelId);
  return queue ? !!queue.isArenaPicking : false;
}

module.exports.isAllRankQueue = isAllRankQueue;
module.exports.isPlayerPicking = isPlayerPicking;
module.exports.isArenaPicking = isArenaPicking;