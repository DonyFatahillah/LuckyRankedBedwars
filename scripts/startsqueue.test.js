const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const discord = require('discord.js');

function harness({ count = 2, admin = true, valid = true, busy = false, active = false, maps = true, layout = '2v2_CROSS', configured = true, created = true } = {}) {
  const calls = { starts: [], replies: [] };
  const members = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`, user: { bot: false }, voice: { channelId: 'queue' }
  }));
  const channel = { id: 'queue', members: new Map(members.map(m => [m.id, m])) };
  if (members[0]) members[0].voice.channel = channel;
  const queue = { voiceChannelId: 'queue', isDebug: true, type: '2v2', redisQueueType: layout };
  const locks = new Map(busy ? [['queue', true]] : []);
  const mocks = {
    'discord.js': discord,
    '../../config/eloQueues': configured ? [queue] : [],
    '../../utils/mapPicker': { getRandomMaps: () => maps ? ['DoubleMap'] : [] },
    '../../queue/queueManager': {
      queueLocks: locks,
      getActiveGames: async () => active ? [{ players: ['p0'] }] : [],
      validateQueueMembers: async () => valid ? members : [],
      createMatch: async (...args) => { calls.starts.push(args); return created ? ['p0', 'p1'] : undefined; }
    }
  };
  const filename = path.join(__dirname, '../src/commands/admin/startsqueue.js');
  const context = {
    module: { exports: {} }, console: { error() {} },
    require(name) {
      if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
      return mocks[name];
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const command = context.module.exports;
  const interaction = {
    inGuild: () => true, memberPermissions: { has: () => admin }, user: { id: 'p0' },
    guild: { members: { fetch: async () => members[0] } },
    deferReply: async () => {}, reply: async payload => calls.replies.push(payload.content),
    editReply: async text => calls.replies.push(text)
  };
  return { command, interaction, calls, locks };
}

for (const layout of ['2v2_CROSS', '2v2_SIDE']) {
  for (const count of [2, 4]) {
    test(`/startsqueue starts ${layout} with ${count} players and keeps the layout override`, async () => {
      const { command, interaction, calls, locks } = harness({ layout, count });
      await command.execute(interaction);
      assert.equal(calls.starts.length, 1);
      assert.equal(calls.starts[0][1].length, count);
      assert.equal(calls.starts[0][2], count / 2);
      assert.equal(calls.starts[0][3].eloQueue.redisQueueType, layout);
      assert.match(calls.replies.at(-1), /Started/);
      assert.equal(locks.has('queue'), false);
      assert.equal(command.data.toJSON().name, 'startsqueue');
      assert.equal(command.data.toJSON().default_member_permissions, String(discord.PermissionFlagsBits.Administrator));
    });
  }
}

for (const [description, options, message] of [
  ['non-admin', { admin: false }, /administrator-only/],
  ['wrong voice', { configured: false }, /Join the configured/],
  ['busy queue', { busy: true }, /already being processed/],
  ['three players', { count: 3 }, /exactly 2 or 4/],
  ['ineligible players', { valid: false }, /eligibility checks/],
  ['active player', { active: true }, /already in an active match/],
  ['empty maps pool', { maps: false }, /maps_2v2/],
  ['match creation refusal', { created: false }, /could not start/]
]) {
  test(`/startsqueue handles ${description}`, async () => {
    const { command, interaction, calls, locks } = harness(options);
    await command.execute(interaction);
    assert.match(calls.replies.at(-1), message);
    if (!options.created && options.created !== undefined) assert.equal(calls.starts.length, 1);
    else assert.equal(calls.starts.length, 0);
    if (!options.busy) assert.equal(locks.has('queue'), false);
  });
}
