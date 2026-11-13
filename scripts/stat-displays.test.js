const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const discord = require('discord.js');

// Execute commands with isolated dependencies: no DB, Redis, Discord, or skin requests.
function loadCommand(relativePath, mocks) {
  const filename = path.join(__dirname, '..', relativePath);
  const context = {
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process: { env: {} },
    Date,
    console: { log() {}, error: (...args) => { throw new Error(args.map(String).join(' ')); } },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      if (name === 'discord.js') return discord;
      if (name === 'path') return path;
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

async function renderProfile(playerData, fallbackStats = {}) {
  const drawn = [];
  const drawingContext = {
    drawImage() {},
    fillText(value, x, y) { drawn.push({ value, x, y }); }
  };
  const member = { user: { username: 'Test' }, roles: { cache: new Set(['1401289452633985086']) } };
  const command = loadCommand('src/commands/misc/profile.js', {
    canvas: {
      registerFont() {},
      loadImage: async () => ({}),
      createCanvas: () => ({ getContext: () => drawingContext, toBuffer: () => Buffer.from('mock image') })
    },
    axios: { get: async () => ({ data: Buffer.alloc(0) }) },
    dotenv: { config() {} },
    '../../models/PlayerSchema': { findOne: async () => playerData },
    '../../models/Player': { load: async () => ({
      elo: 100, ingameUsername: 'Fallback', getStats: () => fallbackStats
    }) },
    '../../utils/EloRank': { getRankByElo: () => ({ name: 'Test Rank' }) }
  });
  let reply;
  await command.execute({
    deferReply: async () => {},
    options: { getUser: () => null, getString: () => null },
    user: { id: '1234' },
    guild: { members: { fetch: async () => member } },
    editReply: async payload => { reply = payload; }
  });
  return { embed: reply.embeds[0].toJSON(), drawn, reply };
}

test('profile displays both modes and keeps MVPs separate from actual kills', async () => {
  const { embed, drawn, reply } = await renderProfile({
    ingameUsername: 'Test', elo: 100, wins: 2, losses: 1, mvps: 7,
    kills: 12, deaths: 5, double_kills: 9, double_deaths: 0
  });
  assert.equal(embed.fields[0].name, 'Normal (3v3 / 4v4)');
  assert.equal(embed.fields[0].value, 'Kills: **12**\nDeaths: **5**\nK/D: **2.40**');
  assert.equal(embed.fields[1].name, 'Doubles (2v2)');
  assert.equal(embed.fields[1].value, 'Kills: **9**\nDeaths: **0**\nK/D: **9.00**');
  assert.equal(drawn.find(item => item.x === 863 && item.y === 410).value, '7');
  assert.equal(reply.files.length, 1);
});

test('profile defaults missing combat fields to zero', async () => {
  const { embed } = await renderProfile({ ingameUsername: 'Legacy' });
  for (const field of embed.fields) {
    assert.equal(field.value, 'Kills: **0**\nDeaths: **0**\nK/D: **0.00**');
  }
});

test('profile uses Player.getStats combat fields on fallback', async () => {
  const { embed } = await renderProfile(null, {
    wins: 0, losses: 0, kills: 3, deaths: 2, double_kills: 8, double_deaths: 4
  });
  assert.match(embed.fields[0].value, /K\/D: \*\*1.50\*\*/);
  assert.match(embed.fields[1].value, /K\/D: \*\*2.00\*\*/);
});

async function renderLeaderboard({ mode = 'normal', season = null, players }) {
  let sort;
  let reply;
  const handlers = {};
  const message = {
    createMessageComponentCollector: () => ({ on: (event, handler) => { handlers[event] = handler; }, resetTimer() {} }),
    edit: async payload => { reply = payload; }
  };
  const command = loadCommand('src/commands/public/leaderboard.js', {
    fs: { existsSync: () => true, readFileSync: () => JSON.stringify({ players }) },
    '../../utils/EloRank': { getRankByElo: () => ({ name: 'Test Rank' }) },
    '../../models/PlayerSchema': { find: () => ({ sort: value => {
      sort = value;
      return { lean: async () => players };
    } }) }
  });
  await command.execute({
    deferReply: async () => {},
    options: { getString: name => name === 'mode' ? mode : season },
    editReply: async payload => { reply = payload; return message; }
  });
  return { getReply: () => reply, sort, handlers };
}

const player = {
  userId: '1234', ingameUsername: 'Test', elo: 100, wins: 3, losses: 1, kills: 12, deaths: 5,
  double_elo: 200, double_wins: 2, double_losses: 4, double_kills: 9, double_deaths: 6
};

for (const mode of ['normal', 'doubles']) {
  test(`leaderboard uses ${mode} stats and retains ELO sorting`, async () => {
    const { getReply, sort } = await renderLeaderboard({ mode, players: [player] });
    assert.equal(sort[mode === 'normal' ? 'elo' : 'double_elo'], -1);
    const description = getReply().embeds[0].toJSON().description;
    assert.ok(description.includes(mode === 'normal'
      ? '(W: 3 / L: 1 | K: 12 / D: 5)'
      : '(W: 2 / L: 4 | K: 9 / D: 6)'));
  });
}

test('live leaderboard defaults missing combat fields to zero', async () => {
  const { getReply } = await renderLeaderboard({ players: [{ userId: '1234' }] });
  assert.match(getReply().embeds[0].toJSON().description, /K: 0 \/ D: 0/);
});

test('archived leaderboard distinguishes missing data from recorded zero', async () => {
  const { getReply } = await renderLeaderboard({ season: 'S1', players: [
    { userId: '1234', ingameUsername: 'Legacy', elo: 20 },
    { userId: '5678', ingameUsername: 'Recorded', elo: 10, kills: 0, deaths: 0 }
  ] });
  const description = getReply().embeds[0].toJSON().description;
  assert.match(description, /Legacy.*K: N\/A \/ D: N\/A/);
  assert.match(description, /Recorded.*K: 0 \/ D: 0/);
});

test('old archives still reject doubles when doubles ELO is absent', async () => {
  const { getReply } = await renderLeaderboard({ mode: 'doubles', season: 'S1', players: [{ userId: '1234' }] });
  assert.match(getReply().content, /No doubles leaderboard data/);
});

test('leaderboard pagination and expiry preserve combat stats', async () => {
  const players = Array.from({ length: 11 }, (_, index) => ({ ...player, userId: String(index), ingameUsername: `Player${index}` }));
  const { getReply, handlers } = await renderLeaderboard({ players });
  await handlers.collect({ customId: 'next', deferUpdate: async () => {} });
  assert.match(getReply().embeds[0].toJSON().description, /Player10.*K: 12 \/ D: 5/);
  await handlers.end();
  const reply = getReply();
  assert.match(reply.embeds[0].toJSON().footer.text, /Interaction expired/);
  assert.ok(reply.components[0].toJSON().components.every(button => button.disabled));
});
