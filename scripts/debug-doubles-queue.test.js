const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const discord = require('discord.js');
const yaml = require('js-yaml');

// Strict dependency injection: no .env reads, service connections, or real data writes.
function loadModule(relativePath, mocks = {}, env = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const context = {
    module: { exports: {} }, __dirname: path.dirname(filename), process: { env },
    console: { log() {}, warn() {}, error(...args) { throw new Error(args.map(String).join(' ')); } },
    // Resolve simulated movement delays, without opening real timers.
    setTimeout(callback) { callback(); return 0; },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      if (name === 'path') return path;
      if (name === 'discord.js') return discord;
      if (name === 'js-yaml') return yaml;
      if (name === 'dotenv') return { config() {} };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

const DEBUG_ENV = {
  QUEUE_2V2_CROSS_DEBUG_VOICE_ID: 'ch-cross',
  QUEUE_2V2_SIDE_DEBUG_VOICE_ID: 'ch-side'
};

test('both doubles queues disable team drafting but keep arena voting', () => {
  const queues = loadModule('src/config/eloQueues.js', {}, DEBUG_ENV);
  for (const [type, channelId] of [['2v2_CROSS', 'ch-cross'], ['2v2_SIDE', 'ch-side']]) {
    const queue = queues.find(q => q.redisQueueType === type);
    assert.equal(queue.type, '2v2');
    assert.equal(queue.voiceChannelId, channelId);
    assert.equal(queue.minElo, 0);
    assert.equal(queue.maxElo, Infinity);
    assert.equal(queues.isPlayerPicking(channelId), false);
    assert.equal(queues.isArenaPicking(channelId), true);
    assert.equal(queues.isAllRankQueue(channelId), true);
  }
});

test('queue2v2 requires four players and forwards the layout config', async () => {
  const calls = [];
  const queue = loadModule('src/queue/queue2v2.js', {
    './queueManager': {
      getEligiblePlayers: async members => members,
      createMatch: async (...args) => { calls.push(args); }
    },
    '../models/Player': {}
  });
  const members = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}` }));
  const config = { redisQueueType: '2v2_SIDE' };
  await queue.handleQueue({}, members.slice(0, 3), config);
  assert.equal(calls.length, 0);
  await queue.handleQueue({}, members, config);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].length, 4);
  assert.equal(calls[0][2], 2);
  assert.equal(calls[0][3].eloQueue, config);
});

function createMatchHarness({ picking = false, arena = picking, party = false } = {}) {
  const captured = { published: [], saved: [], logs: [], voting: [], messages: [] };
  const members = ['p1', 'p2', 'p3', 'p4'].map(id => ({
    id, user: { username: id }, displayName: id,
    guild: { roles: { everyone: { id: 'everyone' } } },
    roles: { cache: new Set() },
    voice: { channelId: 'queue', setChannel: async () => {} }
  }));
  let nextChannel = 0;
  const guild = {
    channels: { create: async () => ({ id: `ch${++nextChannel}`, send: async payload => { captured.messages.push(payload); } }) },
    members: { fetch: async id => members.find(m => m.id === id) }
  };
  const queues = { isPlayerPicking: () => picking, isArenaPicking: () => arena };
  const manager = loadModule('src/queue/queueManager.js', {
    fs: { readFileSync: () => fs.readFileSync(path.join(__dirname, '../data/queueRules.yaml'), 'utf8') },
    '../utils/mapPicker': { getRandomMap: () => 'TestMap' },
    '../models/ActiveGameSchema': {},
    '../utils/matchLogger': {
      logMatch: async (...args) => captured.logs.push(args), sendLogToStaffChannel: async () => {}
    },
    '../models/Player': { load: async m => ({ id: m.id, member: m, ingameUsername: m.id, elo: 100 }) },
    '../utils/partySystem': { getPartyByUser: async id => party && ['p1', 'p2'].includes(id) ? { leaderId: 'p1', members: ['p1', 'p2'] } : null },
    '../utils/redisClient': {
      publishMatch: async payload => captured.published.push(payload),
      getPlayerOnlineStatus: async () => ({ status: 'online' }), redis: {}
    },
    '../utils/voiceJoinTracker': { getJoinTime: () => 0 },
    '../config/eloQueues': queues,
    '../utils/matchFinalizer': { startMapVoting: async (guild, channel, game) => { captured.voting.push(game); } },
    '../models/ActiveGame': class {
      constructor(data) { Object.assign(this, data); }
      async save() { captured.saved.push(this); }
    }
  });
  return { manager, guild, members, captured };
}

for (const layout of ['2v2_CROSS', '2v2_SIDE']) {
  test(`${layout} starts in drafting phase and does not publish before voting`, async () => {
    const { manager, guild, members, captured } = createMatchHarness({ picking: true });
    await manager.createMatch(guild, members, 2, { eloQueue: { redisQueueType: layout, voiceChannelId: 'q' } });
    const game = captured.saved[0];
    assert.equal(game.queueType, layout);
    assert.equal(game.status, 'picking');
    assert.equal(game.teamA.length, 1);
    assert.equal(game.teamB.length, 1);
    assert.equal(game.unpickedPlayers.length, 2);
    assert.equal(game.isArenaPicking, true);
    assert.equal(captured.published.length, 0);
    assert.equal(game.rules.format, '2v2');
    assert.match(game.rules.rulesEmbed, /Diamond Armor \(only 1\)/);
  });

  test(`${layout} survives the non-picking publish path`, async () => {
    const { manager, guild, members, captured } = createMatchHarness();
    await manager.createMatch(guild, members, 2, { eloQueue: { redisQueueType: layout, voiceChannelId: 'q' } });
    assert.equal(captured.published[0].queueType, layout);
    assert.equal(captured.published[0].teamA.length, 2);
    assert.equal(captured.published[0].teamB.length, 2);
    assert.equal(captured.published[0].map, 'w_2_0_testmap');
    const rulesText = captured.messages.find(message => message.embeds)?.embeds[0].description;
    assert.match(rulesText, /Diamond Armor \(only 1\)/);
    assert.match(rulesText, /After Diamond II/);
    assert.match(rulesText, /Iron Golems/);
  });
}

for (const count of [2, 4]) {
  test(`${count}-player doubles uses automatic teams with parties and keeps arena voting`, async () => {
    const { manager, guild, members, captured } = createMatchHarness({ arena: true, party: true });
    await manager.createMatch(guild, members.slice(0, count), count / 2, {
      eloQueue: { redisQueueType: '2v2_SIDE', voiceChannelId: 'q' }
    });
    const game = captured.saved[0];
    assert.equal(game.status, 'voting');
    assert.equal(game.queueType, '2v2_SIDE');
    assert.equal(game.teamA.length, count / 2);
    assert.equal(game.teamB.length, count / 2);
    assert.equal(game.isPlayerPicking, false);
    assert.equal(game.isArenaPicking, true);
    assert.equal(captured.voting.length, 1);
    assert.equal(captured.published.length, 0);
    if (count === 4) {
      const partyTeam = game.teamA.includes('p1') ? game.teamA : game.teamB;
      assert.ok(partyTeam.includes('p2'));
    }
  });
}

test('standard queue type is unchanged and incomplete matches cannot publish', async () => {
  const { manager, guild, members, captured } = createMatchHarness();
  await manager.createMatch(guild, members.slice(0, 3), 2);
  assert.equal(captured.published.length, 0);
  await manager.createMatch(guild, members, 2);
  assert.equal(captured.published[0].queueType, '2v2');
  assert.equal(captured.published[0].map, 'w_2_0_testmap');
});

function mapHarness(data) {
  const writes = [];
  const picker = loadModule('src/utils/mapPicker.js', {
    fs: {
      readFileSync: () => yaml.dump(data),
      writeFileSync: (filename, content) => writes.push(yaml.load(content))
    }
  });
  picker.loadMapList();
  return { picker, writes };
}

test('doubles map choices and random selections never use the normal pool', () => {
  const { picker, writes } = mapHarness({ maps: ['NormalOnly'], maps_2v2: ['Double1', 'Double2'] });
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(Array.from(picker.getRandomMaps(3, '2v2')).sort(), ['Double1', 'Double2']);
    assert.ok(['Double1', 'Double2'].includes(picker.getRandomMap('2v2')));
    assert.equal(picker.getRandomMap(), 'NormalOnly');
  }
  assert.deepEqual(writes.at(-1).maps_2v2, ['Double1', 'Double2']);
  assert.deepEqual(writes.at(-1).maps, ['NormalOnly']);
});

test('empty or missing doubles pool never falls back to normal or Unknown Map', () => {
  for (const maps_2v2 of [undefined, []]) {
    const { picker } = mapHarness({ maps: ['NormalOnly'], maps_2v2 });
    assert.equal(picker.getRandomMaps(3, '2v2').length, 0);
    assert.throws(() => picker.getRandomMap('2v2'), /No doubles maps configured/);
  }
});

test('finishing the 2v2 draft makes two teams of two and starts map voting', async () => {
  let votingGame;
  const game = {
    gameId: 'ABC123', queueType: '2v2_SIDE', pickingPhase: true, pickingTurn: 'p1',
    captainIds: ['p1', 'p2'], teamA: ['p1'], teamB: ['p2'],
    unpickedPlayers: ['p3', 'p4'], isArenaPicking: true, save: async () => {}
  };
  const event = loadModule('src/events/PickingInteraction.js', {
    '../models/ActiveGame': { load: async () => game },
    '../utils/matchFinalizer': { startMapVoting: async (guild, channel, data) => { votingGame = data; } },
    '../queue/queueManager': {}
  });
  await event.execute({
    isStringSelectMenu: () => true, isButton: () => false,
    customId: 'picking-select-ABC123', user: { id: 'p1' }, values: ['p3'],
    guild: {}, channel: {}, deferUpdate: async () => {}, editReply: async () => {}
  });
  assert.deepEqual(game.teamA, ['p1', 'p3']);
  assert.deepEqual(game.teamB, ['p2', 'p4']);
  assert.equal(votingGame, game);
  assert.equal(game.status, 'voting');
});

for (const queueType of ['2v2_CROSS', '2v2_SIDE', '2v2', '3v3', '4v4']) {
  test(`${queueType} voting requests the correct map pool`, async () => {
    let requestedMode;
    let options;
    const finalizer = loadModule('src/utils/matchFinalizer.js', {
      '../models/ActiveGame': {}, '../utils/redisClient': {},
      '../models/Player': {}, '../utils/matchLogger': {},
      './mapPicker': { getRandomMaps: (count, mode) => {
        assert.equal(count, 3);
        requestedMode = mode;
        return ['ConfiguredMap'];
      } }
    });
    await finalizer.startMapVoting({}, {
      send: async payload => { options = payload; },
      createMessageComponentCollector: () => ({ on() {} })
    }, { queueType, gameId: 'ABC123', teamA: ['p1'], teamB: ['p2'], players: ['p1', 'p2'] });
    assert.equal(requestedMode, queueType.startsWith('2v2') ? '2v2' : undefined);
    assert.equal(options.components[0].toJSON().components[0].label, 'ConfiguredMap');
  });
}

for (const queueType of ['2v2_CROSS', '2v2_SIDE', '2v2', '3v3', '4v4']) {
  test(`${queueType} publishes the voted map with the correct arena prefix`, async () => {
    let published;
    const handlers = {};
    const game = {
      queueType, gameId: 'ABC123', categoryId: 'category',
      teamA: ['p1'], teamB: ['p2'], players: ['p1', 'p2'],
      captainIds: ['p1', 'p2'], save: async () => {}
    };
    const guild = {
      channels: { create: async () => ({ id: 'team-voice' }), cache: { find: () => null } },
      members: { fetch: async id => ({ id }) }, client: { user: { id: 'bot' } }
    };
    const channel = {
      send: async () => ({ edit: async () => {} }),
      messages: { fetch: async () => [] },
      createMessageComponentCollector: () => ({ on: (event, callback) => { handlers[event] = callback; } })
    };
    const finalizer = loadModule('src/utils/matchFinalizer.js', {
      '../models/ActiveGame': { load: async () => game },
      '../utils/redisClient': { publishMatch: async payload => { published = payload; } },
      '../models/Player': { load: async member => ({ id: member.id, ingameUsername: member.id, elo: 100 }) },
      '../utils/matchLogger': { logMatch: async () => {} },
      '../queue/queueManager': { getPermissionOverwrites: () => [] },
      './mapPicker': { getRandomMaps: () => ['ConfiguredMap'] }
    });
    await finalizer.startMapVoting(guild, channel, game);
    assert.equal(published, undefined);
    await handlers.end();
    assert.equal(game.map, 'ConfiguredMap');
    assert.equal(published.queueType, queueType);
    assert.equal(published.map, `${queueType.startsWith('2v2') ? 'w_2_0_' : 'w_4_0_'}configuredmap`);
  });
}

test('empty doubles map pool stops voting with a configuration message', async () => {
  let message;
  const finalizer = loadModule('src/utils/matchFinalizer.js', {
    '../models/ActiveGame': {}, '../utils/redisClient': {},
    '../models/Player': {}, '../utils/matchLogger': {},
    './mapPicker': { getRandomMaps: () => [] }
  });
  await finalizer.startMapVoting({}, { send: async text => { message = text; } }, { queueType: '2v2_SIDE' });
  assert.match(message, /maps_2v2/);
  assert.match(message, /No match was sent/);
});
