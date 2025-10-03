const { Events, PermissionFlagsBits } = require('discord.js');
require('dotenv').config({ path: __dirname + '../.env' });

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignore bot messages
        if (message.author.bot) return;

        // Replace with your channel ID
        const restrictedChannelId = process.env.VERIFICATION_CHANNEL_ID;

        // Check if message is in the restricted channel
        if (message.channel.id !== restrictedChannelId) return;

        // Allow admins to type
        if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

        // If not admin → delete the message
        try {
            await message.delete();
        } catch (err) {
            console.error("Failed to delete message:", err);
        }
    },
};
