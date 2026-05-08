// src/events/messageCreatePacks.js
const { Events, PermissionFlagsBits } = require('discord.js');
require('dotenv').config({ path: __dirname + '/../.env' });

const SHARE_PACKS_CHANNEL_ID = process.env.SHARE_PACKS_CHANNEL_ID;

function isEligible(message) {
  const content = message.content?.toLowerCase() || '';
  const attachments = [...message.attachments.values()];

  const hasMediafireLink = content.includes('mediafire.com');
  const hasDriveLink = content.includes('drive.google.com');

  const hasImageAttachment = attachments.some(att => {
    const name = att.name?.toLowerCase() || '';
    return (
      name.endsWith('.png') ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.gif')
    );
  });

  const hasArchiveAttachment = attachments.some(att => {
    const name = att.name?.toLowerCase() || '';
    return name.endsWith('.zip') || name.endsWith('.rar');
  });

  // ✅ ALLOWED CONDITIONS:
  return (
    // 1. Image + MediaFire/Drive link (with or without text)
    (hasImageAttachment && (hasMediafireLink || hasDriveLink)) ||
    (content.trim().length > 0 && hasImageAttachment && (hasMediafireLink || hasDriveLink)) ||

    // 2. Only MediaFire/Drive link (with or without text)
    (hasMediafireLink || hasDriveLink) ||

    // 3. Archive files (.zip or .rar) (with or without text)
    hasArchiveAttachment
  );
}

async function cleanInvalidMessages(client) {
  const channel = await client.channels.fetch(SHARE_PACKS_CHANNEL_ID).catch(() => null);
  if (!channel) return console.warn('[SharePacksCleaner] Channel not found.');

  console.log('[SharePacksCleaner] Scanning old messages in share-packs channel...');

  let deletedCount = 0;
  const messages = await channel.messages.fetch({ limit: 100 });

  for (const [_, message] of messages) {
    if (message.author.bot) continue;
    if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) continue;
    if (!isEligible(message)) {
      await message.delete().catch(() => {});
      deletedCount++;
    }
  }

  console.log(`[SharePacksCleaner] Cleaned ${deletedCount} invalid messages.`);
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    if (message.channel.id !== SHARE_PACKS_CHANNEL_ID) return;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return;

    if (!isEligible(message)) {
      await message.delete().catch(() => {});
      const warning = await message.channel.send({
        content: `⚠️ Only messages containing:
        • an **image + MediaFire/Drive link**,  
        • a **MediaFire/Drive link** alone, or  
        • a **.zip/.rar file** are allowed in this channel.`,
      });
      setTimeout(() => warning.delete().catch(() => {}), 5000);
    }
  },
  cleanInvalidMessages,
};
