const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const scoreStats = require('../src/utils/scoreStats');

const FIELDS = ['kills', 'deaths', 'diamonds', 'emeralds', 'iron', 'gold'];
const COUNTS = { kills: 8, deaths: 3, diamonds: 6, emeralds: 4, iron: 250, gold: 32 };

function load(relative, mocks) {
  const filename = path.join(__dirname, '..', relative);
  const context = {
    module: { exports: {} }, process: { env: {} },
    console: { log() {}, warn() {}, error(...args) { throw new Error(args.map(String).join(' ')); } },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      if (name === 'dotenv') return { config() {} };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

function createHarness(mode, payloadMode = mode) {
  const cache = new Map();
  const mongo = new Map();
  const writes = [];
  const members = new Map(['Alice', 'Bob'].map((name, i) => [String(i), {
    id: String(i), user: { username: name }, displayName: name,
    roles: { cache: new Set() }, setNickname: async () => {}
  }]));
  for (const [id, member] of members) {
    mongo.set(id, {
      ingameUsername: member.user.username, wins: 2, losses: 1, winstreak: 2,
      ...Object.fromEntries(FIELDS.flatMap(field => [[field, 10], [`double_${field}`, 100]]))
    });
  }
  const Player = load('src/models/Player.js', {
    '../utils/eloManager': { getElo: async () => 0, setElo: async () => {} },
    '../utils/EloRank': { updateRankRoles: async () => {} },
    '../utils/redisClient': {
      getPlayerCache: async id => cache.get(id),
      setPlayerCache: async (id, data) => { cache.set(id, data); },
      deletePlayerCache: async () => {}
    },
    './PlayerSchema': {
      findOne: async ({ userId }) => mongo.get(userId),
      findOneAndUpdate: async ({ userId }, data) => {
        mongo.set(userId, data);
        writes.push({ userId, data });
      }
    }
  });
  const autoConfirm = load('src/utils/autoConfirmMatch.js', {
    '../queue/queueManager': {
      getActiveGames: async () => ['ABC', 'DEF'].map(gameId => ({
        gameId, teamA: ['0'], teamB: ['1'], queueType: mode
      })),
      deleteActiveGame() {}
    },
    '../models/Player': Player,
    '../config/eloQueues': { isAllRankQueue: () => false },
    './scoreStats': scoreStats,
    './EloRank': {},
    './matchLogger': { getLogs: () => ({}), updateMatchStatus() {}, editLogEmbed: async () => {} }
  });
  const guild = {
    id: 'guild', members: { fetch: async id => members.get(id) },
    channels: { fetch: async () => null }
  };
  const prefix = String(payloadMode).startsWith('2v2') ? 'doubles_' : '';
  const players = ['Alice', 'Bob'].map((ign, i) => ({
    ign, team: i === 0 ? 'teamA' : 'teamB',
    ...Object.fromEntries(FIELDS.map(field => [`${prefix}${field}`, COUNTS[field]]))
  }));
  return {
    Player, members, cache, mongo, writes, players,
    confirm: (gameId = 'ABC', reports = players) => autoConfirm({}, guild, gameId, {
      winner: 'teamA', topKiller: ['Alice'], winBedbreaker: 'Alice', loseBedbreaker: null,
      queueType: payloadMode, players: reports
    })
  };
}

for (const mode of ['3v3', '4v4', '2v2_SIDE', '2v2_CROSS']) {
  test(`${mode} accumulates all six counts for winners and losers in MongoDB and Redis`, async () => {
    const harness = createHarness(mode);
    await harness.confirm();
    await harness.confirm('DEF');
    const doubles = mode.startsWith('2v2');
    for (const id of ['0', '1']) {
      for (const data of [harness.mongo.get(id), harness.cache.get(id)]) {
        for (const field of FIELDS) {
          assert.equal(data[field], 10 + (doubles ? 0 : COUNTS[field] * 2), field);
          assert.equal(data[`double_${field}`], 100 + (doubles ? COUNTS[field] * 2 : 0), `double_${field}`);
        }
      }
    }
    // Stats are already present when win()/lose() perform their first save,
    // and additional MVP/bedbreaker/final saves do not increment them again.
    for (const id of ['0', '1']) {
      const first = harness.writes.find(write => write.userId === id).data;
      const field = doubles ? 'double_kills' : 'kills';
      assert.equal(first[field], (doubles ? 100 : 10) + COUNTS.kills);
    }
    assert.equal(harness.mongo.get('0').wins, 4);
    assert.equal(harness.mongo.get('0').winstreak, 4);
    assert.equal(harness.mongo.get('1').losses, 3);
    assert.equal(harness.mongo.get('1').winstreak, 0);
  });
}

test('active match mode takes precedence, with payload mode as fallback', async () => {
  for (const mode of ['2v2_SIDE', undefined]) {
    const harness = createHarness(mode, '2v2_CROSS');
    await harness.confirm();
    assert.equal(harness.mongo.get('0').double_kills, 108);
    assert.equal(harness.mongo.get('0').kills, 10);
  }
});

test('missing, duplicate, wrong-team, and unmatched reports preserve existing counts', async () => {
  for (const reports of [undefined, [], [{ ign: 'Nobody', kills: 9 }],
    [{ ign: 'Alice', team: 'teamB', kills: 9 }], [{ ign: 'Alice', kills: 9 }, { ign: 'alice', kills: 9 }]]) {
    const harness = createHarness('4v4');
    // null represents an absent players payload (undefined uses the helper default).
    await harness.confirm('ABC', reports ?? null);
    for (const field of FIELDS) {
      assert.equal(harness.mongo.get('0')[field], 10);
      assert.equal(harness.mongo.get('0')[`double_${field}`], 100);
    }
  }
});

test('invalid counts are ignored individually; zero and case-insensitive IGN are accepted', async () => {
  for (const invalid of [null, -1, 1.5, '8', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const harness = createHarness('4v4');
    await harness.confirm('ABC', [{ ign: 'aLiCe', team: 'teamA', kills: invalid, deaths: 0, iron: 250 }]);
    const data = harness.mongo.get('0');
    assert.equal(data.kills, 10);
    assert.equal(data.deaths, 10);
    assert.equal(data.iron, 260);
    assert.equal(data.gold, 10);
  }
});

test('doubles never falls back to regular payload counts', async () => {
  const harness = createHarness('2v2_SIDE');
  await harness.confirm('ABC', [{ ign: 'Alice', team: 'teamA', ...COUNTS }]);
  for (const field of FIELDS) {
    assert.equal(harness.mongo.get('0')[field], 10);
    assert.equal(harness.mongo.get('0')[`double_${field}`], 100);
  }
});

test('legacy players accumulate counts starting at zero', () => {
  const { Player, members } = createHarness('4v4');
  const player = new Player(members.get('0'));
  player.addMatchStats(COUNTS);
  player.addMatchStats(COUNTS, true);
  for (const field of FIELDS) {
    assert.equal(player[field], COUNTS[field]);
    assert.equal(player[`double_${field}`], COUNTS[field]);
  }
});
