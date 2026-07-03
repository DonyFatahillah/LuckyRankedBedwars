const { Events } = require('discord.js');
const { buildQueueStatsEmbed } = require('../commands/public/queuestats');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;

    const content = message.content.toLowerCase().trim();
    if (content === '=qs' || content === '=queuestats') {
      try {
        const result = await buildQueueStatsEmbed(message.channel.id, message.author.id);
        
        if (result.error) {
          return message.reply(result.error);
        }

        await message.reply({ embeds: [result.embed] });
      } catch (error) {
        console.error('[MessageCommandQS] Error:', error);
        await message.reply("❌ An error occurred while fetching queue stats.");
      }
    }
  }
};
