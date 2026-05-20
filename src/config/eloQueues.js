require('dotenv').config();

module.exports = [
  {
    range: [0, 600],
    type: '3v3',
    minElo: 0,
    maxElo: 600,
    voiceChannelId: process.env.QUEUE_0_600_3V3_ELO_VOICE_ID
  },
  {
    range: [0, 600],
    type: '4v4',
    minElo: 0,
    maxElo: 600,
    voiceChannelId: process.env.QUEUE_0_600_4V4_ELO_VOICE_ID
  },
  {
    range: [600, Infinity],
    type: '3v3',
    minElo: 600,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_600_PLUS_3V3_ELO_VOICE_ID
  },
  {
    range: [600, Infinity],
    type: '4v4',
    minElo: 600,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_600_PLUS_4V4_ELO_VOICE_ID
  },
  {
    range: [0, Infinity],
    type: '4v4',
    minElo: 0,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_ALL_RANK_4V4_ID
  },
  {
    range: [0, Infinity],
    type: '3v3',
    minElo: 0,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_ALL_RANK_3V3_ID
  },
  {
    range: [0, Infinity],
    type: '4v4',
    minElo: 0,
    maxElo: Infinity,
    voiceChannelId: process.env.QUEUE_PREMIUM_VOICE_ID,
    requiredRoleId: process.env.PREMIUM_ROLE_ID
  },
  ];

function isAllRankQueue(channelId) {
  const queue = module.exports.find(q => q.voiceChannelId === channelId);
  return queue && queue.minElo === 0 && queue.maxElo === Infinity;
}

module.exports.isAllRankQueue = isAllRankQueue;