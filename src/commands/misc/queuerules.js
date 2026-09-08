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

function formatSection(title, items, emojiPrefix) {
  if (!items || items.length === 0) return '';
  return `**${title}**\n${emojiPrefix}- ${items.join(`\n${emojiPrefix}- `)}\n`;
}

function buildRulesEmbed(gamemode, rules) {
  const allowedEmoji = '<:allowed:1438390107324420166>';
  const midGameEmoji = '<:mid_game:1438845379650130111>';
  const lateGameEmoji = '<:late_game:1438390063569567874>';
  const bannedEmoji = '<:not_allowed:1438390082146144367>';

  const sections = [
    formatSection('Allowed', rules.allowed, allowedEmoji),
    formatSection('After Diamond I', rules.after_diamond_i, midGameEmoji),
    formatSection('After Diamond II', rules.after_diamond_ii, midGameEmoji),
    formatSection('After Diamond III', rules.after_diamond_iii, midGameEmoji),
    formatSection('After Emerald I', rules.after_emerald_i, lateGameEmoji),
    formatSection('After Emerald II', rules.after_emerald_ii, lateGameEmoji),
    formatSection('After Emerald III', rules.after_emerald_iii, lateGameEmoji),
    formatSection('After Any Bed Break', rules.after_any_bed_break, lateGameEmoji),
    formatSection('Banned', rules.banned, bannedEmoji)
  ];

  return new EmbedBuilder()
    .setTitle(`📜 Queue Rules – ${gamemode.toUpperCase()}`)
    .setColor(0x5865F2)
    .setDescription(sections.filter(Boolean).join('\n'));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queuerules')
    .setDescription('View the current season queue rules (3v3 or 4v4)')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Select the gamemode rules to view (Defaults to 4v4)')
        .addChoices(
          { name: '3v3', value: '3v3' },
          { name: '4v4', value: '4v4' }
        )
        .setRequired(false)),

  async execute(interaction) {
    const rules = loadQueueRules();
    if (!rules) {
      return interaction.reply({ content: '❌ Failed to load queue rules.', ephemeral: true });
    }

    const mode = interaction.options.getString('mode') || '4v4';

    if (!rules[mode]) {
      return interaction.reply({ content: `❌ No rules found for **${mode}**.`, ephemeral: true });
    }

    const embed = buildRulesEmbed(mode, rules[mode]);

    return interaction.reply({ embeds: [embed] });
  }
};
