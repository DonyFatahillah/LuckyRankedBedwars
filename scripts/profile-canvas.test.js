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
      throw new Error(`Unexpected dependency ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

function renderer(skinFails = false) {
  const text = [];
  const images = [];
  const ctx = {
    fillText(value, x, y, maxWidth) { text.push({ value, x, y, maxWidth }); },
    drawImage(...args) { images.push(args); }
  };
  const module = load('src/utils/profileImage.js', {
    canvas: {
      registerFont() {}, loadImage: async source => ({ source, width: 150, height: 300 }),
      createCanvas(width, height) {
        assert.equal(width, 1600);
        assert.equal(height, 900);
        return { getContext: () => ctx, toBuffer: () => Buffer.from('png') };
      }
    },
    'discord.js': { AttachmentBuilder: class { constructor(buffer, options) { this.name = options.name; } } },
    axios: { get: async (url, options) => {
      assert.equal(url, 'https://mc-heads.net/body/Example/300');
      assert.equal(options.timeout, 10000);
      if (skinFails) throw new Error('offline');
      return { data: 'skin' };
    } },
    './EloRank': { getRankByElo: () => ({ name: 'Amethyst' }) }
  });
  return { ...module, text, images };
}

test('profile template renders actual combat stats, MVPs, ratios and recent games in their panels', async () => {
  const { generateProfileImage, text, images } = renderer();
  const attachment = await generateProfileImage('Example', {
    elo: 1025, wins: 125, losses: 75, kills: 1580, deaths: 920,
    topKills: 42, bedsBroken: 68, winstreak: 7,
    recentlyPlayed: ['12345', '12344', '12343', '12342', '12341', 'ignored']
  });
  assert.equal(attachment.name, 'profile-debug.png');
  assert.equal(images[0][0].source, path.join(__dirname, '../assets/profile_canvas.png'));
  assert.deepEqual(images[0].slice(1), [0, 0, 1600, 900]);
  const at = (x, y) => text.find(item => item.x === x && item.y === y)?.value;
  assert.equal(at(365, 76), 'Example');
  assert.equal(at(285, 153), 'Amethyst');
  assert.equal(at(265, 214), '1025');
  for (const [x, value] of [[740, '125'], [940, '75'], [1135, '1580'], [1330, '920']]) assert.equal(at(x, 185), value);
  for (const [x, value] of [[740, '1.67'], [940, '1.72'], [1135, '68'], [1330, '42']]) assert.equal(at(x, 382), value);
  assert.equal(at(1270, 565), '7');
  assert.equal(at(1270, 749), '200');
  assert.equal(text.filter(item => item.value.startsWith('Game #')).length, 5);
  assert.equal(images[1][3] / images[1][4], 0.5, 'skin aspect ratio is preserved');
});

test('profile handles absent stats, zero deaths/losses and unavailable skin', async () => {
  const { generateProfileImage, text, images } = renderer(true);
  await generateProfileImage('Example', { wins: 3, kills: 8 });
  assert.equal(images.length, 1);
  for (const value of ['Skin unavailable', 'No recent games', '3.00', '8.00', '0']) {
    assert.ok(text.some(item => item.value === value), value);
  }
});

function command(generateProfileImage) {
  return load('src/commands/admin/debugprofilecanvas.js', {
    'discord.js': { SlashCommandBuilder },
    '../../utils/profileImage': { generateProfileImage }
  });
}

for (const username of [null, 'Example']) {
  test(`debugprofilecanvas uses dummy stats with ${username || 'default username'}`, async () => {
    let reply;
    const cmd = command(async (name, stats) => {
      assert.equal(name, username || 'Molfordan');
      assert.equal(stats.kills, 1580);
      assert.equal(stats.topKills, 42);
      return { name: 'profile-debug.png' };
    });
    assert.equal(cmd.data.toJSON().name, 'debugprofilecanvas');
    await cmd.execute({
      deferReply: async () => {}, options: { getString: () => username },
      editReply: async value => { reply = value; }
    });
    assert.equal(reply.files[0].name, 'profile-debug.png');
    assert.match(reply.content, /Dummy stats only/);
  });
}

test('debugprofilecanvas rejects invalid usernames without rendering', async () => {
  let reply;
  await command(() => { throw new Error('must not render'); }).execute({
    deferReply: async () => {}, options: { getString: () => 'invalid/name' },
    editReply: async value => { reply = value; }
  });
  assert.match(reply.content, /valid Minecraft username/);
});

test('debugprofilecanvas reports rendering errors', async () => {
  let reply;
  await command(async () => { throw new Error('missing template'); }).execute({
    deferReply: async () => {}, options: { getString: () => null },
    editReply: async value => { reply = value; }
  });
  assert.match(reply.content, /Error generating profile canvas: missing template/);
});
