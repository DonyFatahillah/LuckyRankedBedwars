const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const discord = require('discord.js');

async function harness() {
  const handlers = {};
  const edits = [];
  const rendered = [];
  const players = Array.from({ length: 21 }, (_, i) => ({ userId: String(i), ingameUsername: `Player${i}`, elo: 2100 - i }));
  const filename = path.join(__dirname, '../src/commands/public/leaderboard.js');
  const context = { module: { exports: {} }, Date, console: { log() {}, error(...args) { throw new Error(args.join(' ')); } }, require(name) {
    if (name === 'discord.js') return discord;
    if (name === 'fs') return fs;
    if (name === 'path') return path;
    if (name === '../../models/PlayerSchema') return { find: () => ({ sort: () => ({ lean: async () => players }) }) };
    if (name === '../../utils/leaderboardImage') return { generateLeaderboardImage: async (entries, options) => {
      rendered.push(options.startPosition);
      return new discord.AttachmentBuilder(Buffer.from('png'), { name: 'leaderboard.png' });
    } };
    throw new Error(`Unexpected dependency ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const message = {
    edit: async payload => { edits.push(payload); },
    createMessageComponentCollector: () => ({ on(event, handler) { handlers[event] = handler; }, resetTimer() {} })
  };
  await context.module.exports.execute({
    deferReply: async () => {}, options: { getString: () => null },
    editReply: async () => message
  });
  const click = customId => handlers.collect({ customId, deferUpdate: async () => {} });
  return { handlers, edits, rendered, click };
}

test('rapid next clicks are serialized and retain overall positions', async () => {
  const { click, edits, rendered } = await harness();
  await Promise.all([click('next'), click('next')]);
  assert.deepEqual(rendered, [1, 11, 21]);
  for (const edit of edits) {
    assert.equal(edit.embeds, undefined);
    assert.equal(edit.files[0].name, 'leaderboard.png');
    assert.equal(edit.attachments.length, 0);
  }
  assert.equal(edits[0].components[0].toJSON().components[1].disabled, false);
  assert.equal(edits[1].components[0].toJSON().components[1].disabled, true);
});

test('expiry waits for pending navigation and preserves the final image', async () => {
  const { click, handlers, edits } = await harness();
  const navigating = click('next');
  // Let the acknowledged click enqueue its edit before expiry is delivered.
  await Promise.resolve();
  await handlers.end();
  await navigating;
  const last = edits[edits.length - 1];
  assert.equal(edits.length, 2, 'navigation completes before controls are disabled');
  assert.equal(last.embeds, undefined);
  assert.equal(last.content, undefined);
  assert.ok(last.components[0].toJSON().components.every(button => button.disabled));
  assert.equal(last.files, undefined);
  assert.equal(last.attachments, undefined);
});
