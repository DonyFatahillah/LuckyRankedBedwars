const { Events } = require('discord.js');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;

    if (!message.content.startsWith('=')) return;

    const blacklistedChannels = require('../config/blacklistedChannels');
    if (blacklistedChannels.includes(message.channel.id)) return;

    const args = message.content.slice(1).trim().split(/ +/);
    let commandName = args.shift().toLowerCase();

    if (commandName === 'qs') commandName = 'queuestats';
    if (commandName === 'lb') commandName = 'leaderboard';

    const command = message.client.commands.get(commandName);
    if (!command) return; 

    // Create a mock interaction object to satisfy the slash command execute functions
    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: commandName,
      user: message.author,
      member: message.member,
      channel: message.channel,
      guild: message.guild,
      options: {
        getString: (name) => args[0] || null,
        getUser: (name) => message.mentions.users.first() || null,
      },
      deferred: false,
      replied: false,
      deferReply: async () => { mockInteraction.deferred = true; return true; },
      reply: async (payload) => { 
        mockInteraction.replied = true; 
        return message.reply(payload); 
      },
      editReply: async (payload) => { 
        mockInteraction.replied = true; 
        return message.reply(payload); 
      },
      followUp: async (payload) => { 
        return message.reply(payload); 
      }
    };

    try {
      await command.execute(mockInteraction);
    } catch (err) {
      console.error(`[PrefixCommand Error] =${commandName}:`, err);
      await message.reply('⚠️ An internal error occurred while executing this command.').catch(() => {});
    }
  }
};
