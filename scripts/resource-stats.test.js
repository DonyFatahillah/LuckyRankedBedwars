const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const PlayerModel = require('../src/models/PlayerSchema');

const FIELDS = [
  'diamonds', 'emeralds', 'iron', 'gold',
  'double_diamonds', 'double_emeralds', 'double_iron', 'double_gold'
];

// Isolated dependencies: no MongoDB, Redis, or Discord connections.
function loadModule(relativePath, mocks) {
  const filename = path.join(__dirname, '..', relativePath);
  const context = {
    module: { exports: {} },
    process: { env: {} },
    console: { log() {}, error() {} },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

function createMigration(documents, overrides = {}) {
  return loadModule('src/scripts/migrateResourceStats.js', {
    '../models/PlayerSchema': {
      async updateMany(filter, update) {
        const [field] = Object.keys(filter);
        assert.ok(FIELDS.includes(field));
        assert.equal(filter[field].$exists, false);
        assert.equal(update.$set[field], 0);
        let modifiedCount = 0;
        for (const doc of documents) {
          if (!Object.prototype.hasOwnProperty.call(doc, field)) {
            doc[field] = update.$set[field];
            modifiedCount++;
          }
        }
        return { modifiedCount };
      },
      async countDocuments(filter) {
        assert.deepEqual(Array.from(filter.$or, clause => Object.keys(clause)[0]), FIELDS);
        for (const clause of filter.$or) {
          assert.equal(Object.values(clause)[0].$exists, false);
        }
        return documents.filter(doc => FIELDS.some(field => !Object.prototype.hasOwnProperty.call(doc, field))).length;
      },
      ...overrides
    }
  });
}

test('resource fields have numeric zero defaults in the schema', () => {
  const doc = new PlayerModel({ userId: 'test' });
  for (const field of FIELDS) {
    assert.equal(PlayerModel.schema.path(field).instance, 'Number');
    assert.equal(doc[field], 0);
  }
});

test('migration initializes legacy documents and preserves partial and completed data', async () => {
  const completed = Object.fromEntries(FIELDS.map((field, i) => [field, i + 10]));
  const docs = [{ userId: 'legacy' }, { diamonds: 25, double_gold: 0 }, { ...completed }];
  const result = await createMigration(docs)();
  assert.equal(result.initializedFields, 14);
  assert.equal(result.remaining, 0);
  for (const field of FIELDS) assert.equal(docs[0][field], 0);
  assert.equal(docs[0].userId, 'legacy');
  for (const field of FIELDS) assert.equal(docs[1][field], field === 'diamonds' ? 25 : 0);
  assert.deepEqual(docs[2], completed);
});

test('migration is safe to rerun and handles an empty collection', async () => {
  const migrate = createMigration([{}]);
  await migrate();
  assert.equal((await migrate()).initializedFields, 0);
  const emptyResult = await createMigration([])();
  assert.equal(emptyResult.initializedFields, 0);
  assert.equal(emptyResult.remaining, 0);
});

test('migration only initializes absent fields, preserving explicit null and zero', async () => {
  const doc = { diamonds: null, emeralds: 0 };
  await createMigration([doc])();
  assert.equal(doc.diamonds, null);
  assert.equal(doc.emeralds, 0);
});

test('migration rejects database failures and can resume a partial migration', async () => {
  const docs = [{}];
  const error = new Error('database unavailable');
  await assert.rejects(createMigration(docs, { updateMany: async () => { throw error; } }), error);
  assert.equal(Object.keys(docs[0]).length, 0);
  docs[0].diamonds = 42;
  assert.equal((await createMigration(docs)()).initializedFields, 7);
  assert.equal(docs[0].diamonds, 42);
});

test('migration rejects when verification finds missing fields', async () => {
  await assert.rejects(
    createMigration([{}], { countDocuments: async () => 1 }),
    /1 player document\(s\) are still missing resource stats/
  );
});

function createPlayerClass({ doc = null, cached = null } = {}) {
  const writes = { cache: [], mongo: [] };
  const Player = loadModule('src/models/Player.js', {
    '../utils/eloManager': { getElo: async () => 0, setElo: async () => {} },
    '../utils/EloRank': { updateRankRoles: async () => {} },
    '../utils/redisClient': {
      getPlayerCache: async () => cached,
      setPlayerCache: async (id, data) => { writes.cache.push({ id, data }); },
      deletePlayerCache: async () => {}
    },
    './PlayerSchema': {
      findOne: async () => doc,
      findOneAndUpdate: async (filter, data) => { writes.mongo.push({ filter, data }); }
    }
  });
  return { Player, writes };
}

const member = {
  id: '1234', user: { username: 'Test' }, displayName: 'Test',
  roles: { cache: new Set() }, setNickname: async () => {}
};

function assertResources(data, expected) {
  for (const field of FIELDS) assert.equal(data[field], expected[field], field);
}

const resourceValues = Object.fromEntries(FIELDS.map((field, i) => [field, i + 1]));
const zeroValues = Object.fromEntries(FIELDS.map(field => [field, 0]));

test('Player constructor and getStats default legacy resource fields to zero', () => {
  const { Player } = createPlayerClass();
  const player = new Player(member);
  assertResources(player, zeroValues);
  assertResources(player.getStats(), zeroValues);
});

test('Player loads resources from Mongo and preserves them in cache and save', async () => {
  const { Player, writes } = createPlayerClass({ doc: resourceValues });
  const player = await Player.load(member);
  assertResources(player, resourceValues);
  assertResources(writes.cache[0].data, resourceValues);
  assertResources(player.getStats(), resourceValues);
  await player.save();
  assertResources(writes.cache[1].data, resourceValues);
  assertResources(writes.mongo[0].data, resourceValues);
});

test('Player loads resources from cache independently for each mode', async () => {
  const { Player } = createPlayerClass({ cached: resourceValues });
  assertResources(await Player.load(member), resourceValues);
});

test('new and legacy Player loads cache and save zero resource defaults', async () => {
  for (const doc of [null, { wins: 5 }]) {
    const { Player, writes } = createPlayerClass({ doc });
    const player = await Player.load(member);
    assertResources(player, zeroValues);
    assertResources(writes.cache[0].data, zeroValues);
    await player.save();
    assertResources(writes.mongo[0].data, zeroValues);
  }
});
