const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const QUEUE_RULES_PATH = path.join(__dirname, '../../../data/queueRules.yaml');

function loadQueueRules() {
  try {
    const raw = fs.readFileSync(QUEUE_RULES_PATH, 'utf-8');
    return YAML.parse(raw);
  } catch (err) {
    console.error('[QueueRules] Failed to load YAML:', err);
    return null;
  }
}

function formatSection(title, items) {
  return items && items.length > 0 ? `**${title}**\n- ${items.join('\n- ')}\n` : '';
}

function buildRulesEmbed(gamemode, rules) {
  const sections = [
    formatSection('✅ Allowed', rules.allowed),
    formatSection('⏰ After Emerald II', rules.after_emerald_ii),
    formatSection('⚠️ After Any Bed Break', rules.after_any_bed_break),
    formatSection('⛔ Banned', rules.banned)
  ];

  return new EmbedBuilder()
    .setTitle(`📜 Queue Rules – ${gamemode.toUpperCase()}`)
    .setColor(0x5865F2)
    .setDescription(sections.filter(Boolean).join('\n'));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queuerules')
    .setDescription('View the current season queue rules (3v3 & 4v4)'),

  async execute(interaction) {
    const rules = loadQueueRules();
    if (!rules) {
      return interaction.reply({ content: '❌ Failed to load queue rules.', ephemeral: true });
    }

    const embeds = [];

    if (rules['3v3']) {
      embeds.push(buildRulesEmbed('3v3', rules['3v3']));
    }

    if (rules['4v4']) {
      embeds.push(buildRulesEmbed('4v4', rules['4v4']));
    }

    return interaction.reply({ embeds });
  }
};
