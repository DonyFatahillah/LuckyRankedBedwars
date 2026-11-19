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
  const profileImage = loadCommand('src/utils/profileImage.js', {
    canvas: {
      registerFont() {},
      loadImage: async () => ({ width: 150, height: 300 }),
      createCanvas: (width, height) => {
        assert.equal(width, 1600);
        assert.equal(height, 900);
        return { getContext: () => drawingContext, toBuffer: () => Buffer.from('mock image') };
      }
    },
    axios: { get: async () => ({ data: Buffer.alloc(0) }) },
    './EloRank': { getRankByElo: () => ({ name: 'Test Rank' }) }
  });
  let playerLoads = 0;
  const command = loadCommand('src/commands/misc/profile.js', {
    '../../utils/profileImage': profileImage,
    dotenv: { config() {} },
    '../../models/PlayerSchema': { findOne: async () => playerData },
    '../../models/Player': { load: async () => {
      playerLoads++;
      return { elo: 100, ingameUsername: 'Fallback', getStats: () => fallbackStats };
    } }
  });
  let reply;
  await command.execute({
    deferReply: async () => {},
    options: { getUser: () => null, getString: () => null },
    user: { id: '1234' },
    guild: { members: { fetch: async () => member } },
    editReply: async payload => { reply = payload; }
  });
  return { embed: reply.embeds[0].toJSON(), drawn, reply, playerLoads };
}

test('profile displays both modes and keeps MVPs separate from actual kills', async () => {
  const { embed, drawn, reply, playerLoads } = await renderProfile({
    ingameUsername: 'Test', elo: 100, wins: 2, losses: 1, mvps: 7,
    kills: 12, deaths: 5, double_kills: 9, double_deaths: 0,
    bedsBroken: 4, winstreak: 2, recentlyPlayed: ['ABC', 'DEF']
  });
  assert.equal(embed.fields[0].name, 'Normal (3v3 / 4v4)');
  assert.equal(embed.fields[0].value, 'Kills: **12**\nDeaths: **5**\nK/D: **2.40**');
  assert.equal(embed.fields[1].name, 'Doubles (2v2)');
  assert.equal(embed.fields[1].value, 'Kills: **9**\nDeaths: **0**\nK/D: **9.00**');
  const at = (x, y) => drawn.find(item => item.x === x && item.y === y)?.value;
  assert.equal(at(1330, 382), '7');
  assert.equal(at(1135, 185), '12');
  assert.equal(at(1330, 185), '5');
  assert.equal(at(740, 382), '2.00');
  assert.equal(at(940, 382), '2.40');
  assert.equal(at(1135, 382), '4');
  assert.equal(at(1270, 565), '2');
  assert.equal(at(1270, 749), '3');
  assert.equal(at(670, 545), 'Game #ABC');
  assert.equal(at(670, 596), 'Game #DEF');
  assert.equal(playerLoads, 0, 'Mongo profiles do not require Redis or another Player.load');
  assert.equal(reply.files.length, 1);
  assert.equal(reply.files[0].name, 'profile.png');
});

test('profile defaults missing combat fields to zero', async () => {
  const { embed } = await renderProfile({ ingameUsername: 'Legacy' });
  for (const field of embed.fields) {
    assert.equal(field.value, 'Kills: **0**\nDeaths: **0**\nK/D: **0.00**');
  }
});

test('profile uses Player.getStats combat fields on fallback', async () => {
  const { embed, drawn, playerLoads } = await renderProfile(null, {
    wins: 0, losses: 0, kills: 3, deaths: 2, double_kills: 8, double_deaths: 4,
    topKills: 6, bedsBroken: 5, winstreak: 1, recentlyPlayed: ['FALLBACK']
  });
  assert.match(embed.fields[0].value, /K\/D: \*\*1.50\*\*/);
  assert.match(embed.fields[1].value, /K\/D: \*\*2.00\*\*/);
  const at = (x, y) => drawn.find(item => item.x === x && item.y === y)?.value;
  assert.equal(at(265, 214), '100');
  assert.equal(at(1135, 185), '3');
  assert.equal(at(1330, 382), '6');
  assert.equal(at(670, 545), 'Game #FALLBACK');
  assert.equal(playerLoads, 1);
});

async function renderLeaderboard({ mode = 'normal', season = null, players }) {
  let sort;
  let reply;
  const handlers = {};
  const renders = [];
  const edits = [];
  let collectorOptions;
  const message = {
    createMessageComponentCollector: options => {
      collectorOptions = options;
      return { on: (event, handler) => { handlers[event] = handler; }, resetTimer() {} };
    },
    edit: async payload => { edits.push(payload); reply = payload; }
  };
  const command = loadCommand('src/commands/public/leaderboard.js', {
    fs: { existsSync: () => true, readFileSync: () => JSON.stringify({ players }) },
    '../../utils/leaderboardImage': { generateLeaderboardImage: async (entries, options) => {
      renders.push({ entries, options });
      return new discord.AttachmentBuilder(Buffer.from('mock image'), { name: 'leaderboard.png' });
    } },
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
  return { getReply: () => reply, sort, handlers, renders, edits, collectorOptions };
}

const player = {
  userId: '1234', ingameUsername: 'Test', elo: 100, wins: 3, losses: 1, kills: 12, deaths: 5,
  double_elo: 200, double_wins: 2, double_losses: 4, double_kills: 9, double_deaths: 6
};

for (const mode of ['normal', 'doubles']) {
  test(`leaderboard uses ${mode} stats and retains ELO sorting`, async () => {
    const { getReply, sort, renders } = await renderLeaderboard({ mode, players: [{ ...player, minecraftUuid: 'test-uuid' }] });
    assert.equal(sort[mode === 'normal' ? 'elo' : 'double_elo'], -1);
    const entry = renders[0].entries[0];
    assert.deepEqual([entry.elo, entry.wins, entry.losses, entry.kills, entry.deaths],
      mode === 'normal' ? [100, 3, 1, 12, 5] : [200, 2, 4, 9, 6]);
    assert.equal(entry.minecraftUuid, 'test-uuid');
    assert.equal(renders[0].options.startPosition, 1);
    assert.match(renders[0].options.title, mode === 'normal' ? /NORMAL/ : /DOUBLES/);
    assert.equal(getReply().embeds[0].toJSON().image.url, 'attachment://leaderboard.png');
    assert.equal(getReply().files[0].name, 'leaderboard.png');
  });
}

test('live leaderboard defaults missing combat fields to zero', async () => {
  const { renders } = await renderLeaderboard({ players: [{ userId: '1234' }] });
  assert.equal(renders[0].entries[0].kills, 0);
  assert.equal(renders[0].entries[0].deaths, 0);
});

test('archived leaderboard distinguishes missing data from recorded zero', async () => {
  const { renders } = await renderLeaderboard({ season: 'S1', players: [
    { userId: '5678', ingameUsername: 'Recorded', elo: 10, kills: 0, deaths: 0 },
    { userId: '1234', ingameUsername: 'Legacy', elo: 20 }
  ] });
  assert.equal(renders[0].entries[0].username, 'Legacy');
  assert.equal(renders[0].entries[0].kills, null);
  assert.equal(renders[0].entries[0].deaths, null);
  assert.equal(renders[0].entries[1].kills, 0);
  assert.equal(renders[0].entries[1].deaths, 0);
  assert.match(renders[0].options.title, /SEASON S1/);
});

test('old archives still reject doubles when doubles ELO is absent', async () => {
  const { getReply } = await renderLeaderboard({ mode: 'doubles', season: 'S1', players: [{ userId: '1234' }] });
  assert.match(getReply().content, /No doubles leaderboard data/);
});

test('leaderboard pagination and expiry preserve combat stats', async () => {
  const players = Array.from({ length: 11 }, (_, index) => ({ ...player, userId: String(index), ingameUsername: `Player${index}` }));
  const { getReply, handlers, renders, collectorOptions } = await renderLeaderboard({ players });
  assert.equal(collectorOptions.idle, 60000);
  await handlers.collect({ customId: 'next', deferUpdate: async () => {} });
  assert.equal(renders[1].entries[0].username, 'Player10');
  assert.equal(renders[1].entries[0].kills, 12);
  assert.equal(renders[1].entries[0].deaths, 5);
  assert.equal(renders[1].options.startPosition, 11);
  assert.equal(getReply().attachments.length, 0, 'old image is replaced, not accumulated');
  assert.equal(getReply().files.length, 1);
  await handlers.collect({ customId: 'prev', deferUpdate: async () => {} });
  assert.equal(renders.length, 2, 'revisited page uses cached image');
  await handlers.end();
  const reply = getReply();
  assert.match(reply.embeds[0].toJSON().footer.text, /Page 1 of 2.*Interaction expired/);
  assert.equal(reply.files, undefined, 'expiry preserves existing attachment without rerendering');
  assert.equal(reply.attachments, undefined);
  assert.ok(reply.components[0].toJSON().components.every(button => button.disabled));
});
