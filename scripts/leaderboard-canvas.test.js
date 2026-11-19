const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { SlashCommandBuilder } = require('discord.js');

function load(relative, mocks) {
  const filename = path.join(__dirname, '..', relative);
  const context = {
    module: { exports: {} }, __dirname: path.dirname(filename), console: { error() {} },
    require(name) {
      if (name in mocks) return mocks[name];
      if (name === 'path') return path;
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

function renderer() {
  const text = [];
  const images = [];
  const ctx = {
    drawImage: (...args) => images.push(args),
    fillText(value, x, y, maxWidth) { text.push({ value, x, y, maxWidth, color: this.fillStyle }); }
  };
  const module = load('src/utils/leaderboardImage.js', {
    canvas: {
      registerFont() {}, loadImage: async source => ({ source }),
      createCanvas(width, height) {
        assert.equal(width, 1600);
        assert.equal(height, 900);
        return { getContext: () => ctx, toBuffer: () => Buffer.from('png') };
      }
    },
    'discord.js': { AttachmentBuilder: class { constructor(buffer, options) { this.name = options.name; } } },
    './EloRank': { getRankByElo: () => ({ name: 'Amethyst' }) }
  });
  return { ...module, text, images };
}

const entries = Array.from({ length: 11 }, (_, i) => ({
  username: `Player${i + 1}`, elo: 2000 - i * 100, wins: 125, losses: 75, kills: 1580, deaths: 920
}));

test('leaderboard uses the supplied template, ten rows and distinct podium colors', async () => {
  const { generateLeaderboardImage, text, images } = renderer();
  const attachment = await generateLeaderboardImage(entries);
  assert.equal(attachment.name, 'leaderboard.png');
  assert.equal(images[0][0].source, path.join(__dirname, '../assets/leaderboard.png'));
  assert.deepEqual(images[0].slice(1), [0, 0, 1600, 900]);
  const names = text.filter(item => item.value.startsWith('Player'));
  assert.equal(names.length, 10);
  assert.deepEqual(names.slice(0, 4).map(item => item.color), ['#FFD966', '#E6EDF7', '#FFBE98', '#ffffff']);
  assert.equal(names[0].y, 177.5);
  assert.equal(names[9].y, 762.5);
  const at = x => text.find(item => item.x === x && item.y === 177.5)?.value;
  assert.equal(at(150), '#1');
  assert.equal(at(785), '2000');
  assert.equal(at(943), '1.67');
  assert.equal(at(1095), '1.72');
  assert.equal(at(1252), '200');
  assert.equal(at(1410), 'Amethyst');
});

test('later pages do not receive podium colors', async () => {
  const { generateLeaderboardImage, text } = renderer();
  await generateLeaderboardImage(entries, { startPosition: 11 });
  assert.equal(text.find(item => item.value === '#11').color, '#ffffff');
  assert.ok(text.every(item => item.color === '#ffffff'));
});

test('ratios handle zero denominators and missing combat data', async () => {
  const { generateLeaderboardImage, text } = renderer();
  await generateLeaderboardImage([
    { username: 'Zero', wins: 3, losses: 0, kills: 8, deaths: 0 },
    { username: 'Legacy' }
  ]);
  assert.ok(text.some(item => item.value === '3.00'));
  assert.ok(text.some(item => item.value === '8.00'));
  assert.ok(text.some(item => item.value === '0.00'));
  assert.ok(text.some(item => item.value === 'N/A'));
});

test('empty leaderboard shows an empty state', async () => {
  const { generateLeaderboardImage, text } = renderer();
  await generateLeaderboardImage([]);
  assert.ok(text.some(item => item.value === 'No players found'));
});

function command(generateLeaderboardImage) {
  return load('src/commands/admin/debugleaderboardcanvas.js', {
    'discord.js': { SlashCommandBuilder },
    '../../utils/leaderboardImage': { generateLeaderboardImage }
  });
}

test('debug command sends ten sorted dummy players without accessing player data', async () => {
  let reply;
  const cmd = command(async (players, options) => {
    assert.equal(players.length, 10);
    assert.equal(players[0].username, 'Molfordan');
    assert.ok(players.every((p, i) => i === 0 || players[i - 1].elo >= p.elo));
    assert.match(options.title, /NORMAL/);
    return { name: 'leaderboard.png' };
  });
  assert.equal(cmd.data.toJSON().name, 'debugleaderboardcanvas');
  await cmd.execute({ deferReply: async () => {}, editReply: async value => { reply = value; } });
  assert.equal(reply.files[0].name, 'leaderboard.png');
  assert.match(reply.content, /gold, silver, and bronze/);
});

test('debug command reports renderer errors', async () => {
  let reply;
  await command(async () => { throw new Error('missing template'); }).execute({
    deferReply: async () => {}, editReply: async value => { reply = value; }
  });
  assert.match(reply.content, /Error generating leaderboard canvas: missing template/);
});
