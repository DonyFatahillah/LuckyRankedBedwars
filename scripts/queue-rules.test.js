const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const discord = require('discord.js');
const YAML = require('yaml');

const rulesPath = path.join(__dirname, '../data/queueRules.yaml');
const rules = YAML.parse(fs.readFileSync(rulesPath, 'utf8'));

function loadCommand() {
  const filename = path.join(__dirname, '../src/commands/misc/queuerules.js');
  const context = { module: { exports: {} }, __dirname: path.dirname(filename), console, require(name) {
    if (name === 'discord.js') return discord;
    if (name === 'path') return path;
    if (name === 'yaml') return YAML;
    if (name === 'fs') return { readFileSync(file, encoding) {
      assert.equal(file, rulesPath);
      return fs.readFileSync(file, encoding);
    } };
    throw new Error(`Unexpected dependency ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

test('shared 2v2 rules start as a separate editable copy of 3v3', () => {
  assert.deepEqual(rules['2v2'], rules['3v3']);
  assert.notEqual(rules['2v2'], rules['3v3']);
  assert.ok(rules['2v2'].allowed.includes('Diamond Armor (only 1)'));
});

test('queuerules exposes one shared SIDE/CROSS choice', () => {
  const command = loadCommand().data.toJSON();
  const choices = command.options[0].choices;
  assert.deepEqual(choices.map(choice => choice.value), ['2v2', '3v3', '4v4']);
  assert.match(choices[0].name, /SIDE \/ CROSS/);
});

for (const mode of ['2v2', '3v3', '4v4', null]) {
  test(`queuerules displays ${mode || 'default 4v4'} rules from YAML`, async () => {
    let reply;
    await loadCommand().execute({ options: { getString: () => mode }, reply: async payload => { reply = payload; } });
    const selected = mode || '4v4';
    const embed = reply.embeds[0].toJSON();
    assert.match(embed.title, new RegExp(selected.toUpperCase()));
    for (const items of Object.values(rules[selected])) {
      for (const item of items) assert.ok(embed.description.includes(item), item);
    }
  });
}
