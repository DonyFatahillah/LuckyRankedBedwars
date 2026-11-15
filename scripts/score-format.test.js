const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { getMatchDisplayStats, formatScoreStats } = require('../src/utils/scoreStats');

function load(relative, mocks) {
  const filename = path.join(__dirname, '..', relative);
  const context = {
    module: { exports: {} }, __dirname: path.dirname(filename), process: { env: {} },
    console: { log() {}, warn() {}, error(...args) { throw new Error(args.map(String).join(' ')); } },
    require(name) {
      if (name in mocks) return mocks[name];
      if (name === 'path') return path;
      if (name === 'dotenv') return { config() {} };
      throw new Error(`Unexpected dependency ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

test('normal and doubles reports map only the selected mode and roster team', () => {
  const report = [{ ign: 'PlayerOne', team: 'teamA', kills: 8, deaths: 3, diamonds: 12, emeralds: 6,
    doubles_kills: 4, doubles_deaths: 6, doubles_diamonds: 9, doubles_emeralds: 2 }];
  assert.deepEqual(getMatchDisplayStats(report, 'playerone', '4v4', 'teamA'), { kills: 8, deaths: 3, diamonds: 12, emeralds: 6 });
  for (const mode of ['2v2_SIDE', '2v2_CROSS']) {
    assert.deepEqual(getMatchDisplayStats(report, 'PlayerOne', mode, 'teamA'), { kills: 4, deaths: 6, diamonds: 9, emeralds: 2 });
  }
  assert.equal(getMatchDisplayStats(report, 'PlayerOne', '4v4', 'teamB').kills, null);
  assert.equal(getMatchDisplayStats([...report, ...report], 'PlayerOne', '4v4', 'teamA').kills, null);
});

test('K/D has two decimals, zero deaths uses kills, absent or invalid stats are N/A', () => {
  assert.equal(formatScoreStats({ kills: 8, deaths: 3 }).kd, '2.67');
  assert.equal(formatScoreStats({ kills: 8, deaths: 0 }).kd, '8.00');
  assert.equal(formatScoreStats({ kills: 0, deaths: 0 }).kd, '0.00');
  for (const value of [undefined, null, -1, 1.5, '8', Infinity]) {
    const stats = formatScoreStats({ kills: value, deaths: 3 });
    assert.equal(stats.kills, 'N/A');
    assert.equal(stats.kd, 'N/A');
  }
});

test('image draws every requested column, signed Elo changes, and legacy N/A', async () => {
  const drawn = [];
  const ctx = { fillRect() {}, drawImage() {}, fillText: value => drawn.push(String(value)) };
  const image = load('src/utils/scoreImage.js', {
    canvas: { registerFont() {}, loadImage: async () => ({}), createCanvas: () => ({ getContext: () => ctx, toBuffer: () => Buffer.from('png') }) },
    'discord.js': { AttachmentBuilder: class { constructor(buffer, options) { this.name = options.name; } } },
    './EloRank': { getRankByElo: () => ({ name: 'TestRank' }) },
    './scoreStats': { formatScoreStats }
  });
  const attachment = await image.generateScoreImage('ABC', 'team1', [
    { username: 'PlayerOne', name: 'PlayerOne', result: 'Win', oldElo: 100, newElo: 125, kills: 8, deaths: 3, diamonds: 12, emeralds: 6 },
    { nickname: 'LegacyPlayer', result: 'Loss', oldElo: 100, newElo: 105 }
  ], ['PlayerOne'], [], [], 'Archway');
  for (const expected of ['PLAYER', 'KILLS', 'DEATHS', 'K/D', 'DIAMONDS', 'EMERALDS', 'RANK', 'ELO CHANGE',
    'PlayerOne', '8', '3', '2.67', '12', '6', 'TestRank', '(+25)', '(+5)', 'N/A', 'MVP']) {
    assert.ok(drawn.includes(expected), expected);
  }
  assert.equal(attachment.name, 'score-ABC.png');
});

for (const mode of ['4v4', '2v2_SIDE', '2v2_CROSS']) {
  test(`auto-confirm passes ${mode} match stats to the image and normalizes teamA winner`, async () => {
    let imageResults;
    const players = new Map(['One', 'Two'].map((name, i) => [String(i), {
      username: name, ingameUsername: name, elo: 100,
      win: async function () { this.elo += 25; }, lose: async function () { this.elo -= 10; },
      addTopKill: async () => {}, addBedBroken: async () => {}, addRecentGame() {}, save: async () => {}
    }]));
    const autoConfirm = load('src/utils/autoConfirmMatch.js', {
      '../queue/queueManager': {
        getActiveGames: async () => [{ gameId: 'ABC', teamA: ['0'], teamB: ['1'], queueType: mode, map: 'Archway' }],
        deleteActiveGame: async () => {}
      },
      '../models/Player': { load: async member => players.get(member.id) },
      '../config/eloQueues': { isAllRankQueue: () => false },
      './matchLogger': { getLogs: () => ({}), updateMatchStatus: async () => {}, editLogEmbed: async () => {} },
      './scoreStats': { getMatchDisplayStats, formatScoreStats },
      './EloRank': { getRankByElo: () => ({ name: 'TestRank' }) },
      './scoreImage': { generateScoreImage: async (id, winner, results) => { imageResults = results; return {}; } }
    });
    const scoring = { send: async () => {} };
    let fetches = 0;
    const guild = {
      id: 'guild', members: { fetch: async id => ({ id }) },
      channels: { fetch: async () => ++fetches === 1 ? scoring : null }
    };
    const prefix = mode.startsWith('2v2') ? 'doubles_' : '';
    await autoConfirm({}, guild, 'ABC', {
      winner: 'teamA', winBedbreaker: 'One', topKiller: ['One'],
      players: [{ ign: 'One', team: 'teamA', [`${prefix}kills`]: 8, [`${prefix}deaths`]: 3,
        [`${prefix}diamonds`]: 12, [`${prefix}emeralds`]: 6 }]
    });
    const winner = imageResults.find(p => p.username === 'One');
    assert.equal(winner.result, '🏆 Win');
    assert.equal(winner.kills, 8);
    assert.equal(winner.diamonds, 12);
    assert.equal(imageResults.find(p => p.username === 'Two').kills, null);
  });
}
