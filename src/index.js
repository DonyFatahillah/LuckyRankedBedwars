(async () => {
  require('dotenv').config({ path: __dirname + '/../.env' });

  const { Client, IntentsBitField, ActivityType, Collection, EmbedBuilder } = require('discord.js');
  const fs = require('fs');
  const path = require('path');
  const addBedBrokenField = require('./scripts/addBedBreakField');
  const { loadParties } = require('./utils/partySystem');
  const { cleanupExpiredPunishments } = require('./utils/punishmentManager');
  const displayNameCache = require('./cache/displayNameCache');
  const mapPicker = require('./utils/mapPicker');  
  const autoConfirmPendingMatches = require('./utils/autoConfirmPending'); 
  const runCleanup = require('./scripts/cleanupPlayers');  
  const syncRanks = require('./scripts/syncRanks');
  const syncPremium = require('./scripts/syncPremium');
  const syncVerifiedUsers = require('./scripts/syncVerifiedUsers');
  const auditUsers = require('./scripts/auditUsers');
  const {cleanInvalidMessages} = require('./events/messageCreatePacks')
  const connectDB = require('./config/database');
  const { setupResultListener } = require('./utils/redisClient');
  const { setupAllstarsListener } = require('./utils/allstarsManager');

  let loadLogs, cleanMatchLogs, getActiveGames, loadActiveGames, deleteActiveGame, checkAllQueueChannelsOnStartup, startQueuePolling;

  try {
    await connectDB();
    // Run maintenance tasks in background
    auditUsers().catch(console.error);

    ({ loadLogs } = require('./utils/matchLogger'));
    cleanMatchLogs = require('./scripts/cleanupMatchLogs');

    const queueManager = require('./queue/queueManager');
    ({ getActiveGames, loadActiveGames, deleteActiveGame, checkAllQueueChannelsOnStartup, startQueuePolling } = queueManager);

    console.log('[Startup] ✅ Successfully loaded all required modules');

    await loadParties();
    addBedBrokenField();
    await cleanMatchLogs();
    await loadActiveGames();
    await loadLogs();
    
    console.log('[Startup] Data loaded from local cache.');
  } catch (err) {
    console.error('[FATAL] ❌ Error during initialization:', err);
    process.exit(1);
  }

  console.log('[Startup] Bot is initializing...');
  console.log('V:0.2.1')

  const client = new Client({
    intents: [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.MessageContent,
      IntentsBitField.Flags.GuildMembers,
      IntentsBitField.Flags.GuildVoiceStates,
    ],
  });

  console.log('[Startup] ✅ Discord client created');
  
  client.displayNameCache = displayNameCache;

  mapPicker.loadMapList();  // Load ELO data on startup

  try {
    client.commands = loadCommands(path.join(__dirname, 'commands'));
    console.log('[Startup] ✅ Commands loaded');
  } catch (err) {
    console.error('[Startup] ❌ Failed to load commands:', err);
    process.exit(1);
  }

  try {
    console.log('[Startup] Loading event handlers...');
    loadEventHandlers(client, path.join(__dirname, 'events'));
    console.log('[Startup] ✅ Events loaded');
  } catch (err) {
    console.error('[Startup] ❌ Failed to load event handlers:', err);
    process.exit(1);
  }

  async function sendStatusEmbed(type, err = null) {
    try {
      const channelId = process.env.STATUS_CHANNEL_ID || process.env.BOT_STATUS_CHANNEL_ID;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) return;

      const embed = new EmbedBuilder().setTitle('🤖 Bot Status').setTimestamp();

      const pteroDomain = process.env.PTERO_DOMAIN;
      const pteroApiKey = process.env.PTERO_API_KEY;
      const pteroServerId = process.env.PTERO_SERVER_ID;

      let pteroStats = null;
      if (pteroDomain && pteroApiKey && pteroServerId) {
        try {
          const axios = require('axios');
          const response = await axios.get(`${pteroDomain}/api/client/servers/${pteroServerId}/resources`, {
            headers: {
              'Authorization': `Bearer ${pteroApiKey}`,
              'Accept': 'application/json'
            }
          });
          pteroStats = response.data.attributes;
        } catch (fetchErr) {
          console.error('[Ptero API Error]', fetchErr.message);
        }
      }

      if (type === 'online' || type === 'update') {
        embed.setDescription('🟢 Bot is **online** and ready.').setColor(0x00ff00);
      } else if (type === 'shutdown') {
        embed.setDescription('🔴 Bot is **shutting down**.').setColor(0xff9900);
      } else if (type === 'crash') {
        embed
          .setDescription('❌ Bot **crashed with an error**.')
          .setColor(0xff0000)
          .addFields({ name: 'Error', value: `\`\`\`${(err || '').toString().slice(0, 1000)}\`\`\`` });
      }

      let inGamePlayers = 0;
      let inQueuePlayers = 0;
      try {
          if (typeof getActiveGames === 'function') {
              const activeGames = await getActiveGames();
              if (Array.isArray(activeGames)) {
                  inGamePlayers = activeGames.reduce((acc, game) => acc + (game.players ? game.players.length : 0), 0);
              }
          }
          const guildId = process.env.GUILD_ID;
          if (guildId) {
              const guild = client.guilds.cache.get(guildId);
              if (guild) {
                  const seenChannels = new Set();
                  const waitingRoomId = process.env.WAITING_ROOM_VOICE_ID;
                  if (waitingRoomId) {
                      const vc = guild.channels.cache.get(waitingRoomId);
                      if (vc && vc.isVoiceBased()) {
                          inQueuePlayers += vc.members.size;
                          seenChannels.add(waitingRoomId);
                      }
                  }
                  const eloQueues = require('./config/eloQueues');
                  for (const q of eloQueues) {
                      if (q.voiceChannelId && !seenChannels.has(q.voiceChannelId)) {
                          const vc = guild.channels.cache.get(q.voiceChannelId);
                          if (vc && vc.isVoiceBased()) {
                              inQueuePlayers += vc.members.size;
                              seenChannels.add(q.voiceChannelId);
                          }
                      }
                  }
              }
          }
      } catch (e) {
          console.error('[StatusEmbed] Stats error', e);
      }

      embed.addFields(
        { name: 'In Queue', value: `\`${inQueuePlayers} Players\``, inline: true },
        { name: 'In Game', value: `\`${inGamePlayers} Players\``, inline: true }
      );

      try {
          const { redis } = require('./utils/redisClient');
          const payload = JSON.stringify({ inQueue: inQueuePlayers, inGame: inGamePlayers, timestamp: Date.now() });
          await redis.set('bot.status.stats', payload);
          await redis.publish('bot.status.update', payload);
      } catch (err) {
          console.error('[Redis] Failed to send stats to monitor bot:', err.message);
      }

      if (pteroStats) {
        const state = pteroStats.current_state || 'unknown';
        const memory = pteroStats.resources ? (pteroStats.resources.memory_bytes / 1024 / 1024).toFixed(2) : '0.00';
        const cpu = pteroStats.resources ? pteroStats.resources.cpu_absolute.toFixed(2) : '0.00';
        const uptimeMillis = pteroStats.resources ? pteroStats.resources.uptime : 0;
        
        let uptimeStr = "0s";
        if (uptimeMillis > 0) {
          const totalSeconds = Math.floor(uptimeMillis / 1000);
          const d = Math.floor(totalSeconds / (3600 * 24));
          const h = Math.floor((totalSeconds % (3600 * 24)) / 3600);
          const m = Math.floor((totalSeconds % 3600) / 60);
          const s = totalSeconds % 60;
          uptimeStr = `${d}d ${h}h ${m}m ${s}s`;
        }

        embed.addFields(
          { name: 'Server State', value: `\`${state.toUpperCase()}\``, inline: true },
          { name: 'CPU Usage', value: `\`${cpu}%\``, inline: true },
          { name: 'RAM Usage', value: `\`${memory} MB\``, inline: true },
          { name: 'Uptime', value: `\`${uptimeStr}\``, inline: true }
        );
      }

      const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === '🤖 Bot Status') : null;

      if (botMessage && (type === 'online' || type === 'update')) {
        await botMessage.edit({ embeds: [embed] }).catch(console.error);
      } else {
        await channel.send({ embeds: [embed] }).catch(console.error);
      }
    } catch (e) {
      console.error('[Status Embed Error]', e);
    }
  }

  client.once('ready', async () => {
    try {
      console.log(`[Startup] Ready event triggered as ${client.user.tag}`);

      if (client.user.username !== 'LuckyRankedBedwars') {
        client.user.setUsername('LuckyRankedBedwars')
          .then(() => console.log('[Startup] Successfully changed bot username to LuckyRankedBedwars'))
          .catch(err => console.error('[Startup] Failed to change bot username (rate limit or invalid):', err.message));
      }

  // ✅ Confirm pending submitted matches // Preload display names

      const commandsArray = client.commands.map((cmd) => cmd.data.toJSON());

      client.user.setActivity({
        name: 'LuckyNetwork Ranked Bedwars',
        type: ActivityType.Watching,
      });

      await setupResultListener(client);
      await setupAllstarsListener(client);
      
      const { setupDebugStartListener } = require('./utils/debugStartListener');
      await setupDebugStartListener(client);

      if (process.env.GUILD_ID) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID); 
        await guild.commands.set(commandsArray);

        console.log('[Startup] Fetching guild members...');
        const members = await guild.members.fetch({ withPresences: false });

        if (guild.members.me.nickname !== 'LuckyRankedBedwars') {
          guild.members.me.setNickname('LuckyRankedBedwars')
            .then(() => console.log('[Startup] Successfully set bot nickname to LuckyRankedBedwars'))
            .catch(err => console.error('[Startup] Failed to set bot nickname:', err.message));
        }

        await displayNameCache.refresh(client, members);
        await mapPicker.loadMapList();
        await cleanInvalidMessages(client);  
          
        // Run sync tasks asynchronously in the background
        runCleanup(client, members).catch(err => console.error('[Cleanup Error]', err));
        syncRanks(client, members).catch(err => console.error('[SyncRanks Error]', err));  
        syncPremium(client, members).catch(err => console.error('[SyncPremium Error]', err));
        syncVerifiedUsers(client, members).catch(err => console.error('[SyncVerifiedUsers Error]', err));
        autoConfirmPendingMatches(client).catch(err => console.error('[AutoConfirm Error]', err));  
        
        console.log(`✅ Registered slash commands to guild: ${guild.name}`);
      } else {
        await client.application.commands.set(commandsArray);
        console.log('✅ Registered global slash commands');
      }

      // Task runner
      const maintenanceTask = require('./tasks/maintenance');
      await maintenanceTask.execute(client);

      await startQueuePolling(client);

      await sendStatusEmbed('online');
      
      setInterval(() => {
        sendStatusEmbed('update').catch(err => console.error('[BotStatusUpdate Error]', err));
      }, 5000);
    } catch (err) {
      console.error('[FATAL] Error inside ready block:', err);
      await sendStatusEmbed('crash', err);
      process.exit(1);
    }
  });

  await client.login(process.env.DISCORD_TOKEN);

client.on('interactionCreate', async (interaction) => {
  // Handle Autocomplete
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;

    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error(`[Autocomplete Error] /${interaction.commandName}:`, err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const blacklistedChannels = require('./config/blacklistedChannels');
  if (blacklistedChannels.includes(interaction.channelId)) {
    return interaction.reply({ content: '❌ Commands are disabled in this channel.', flags: [64] });
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    // Standard execution wrapper
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Command Error] /${interaction.commandName}:`, err);

    const errorMessage = '⚠️ An internal error occurred while executing this command.';

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: errorMessage }).catch(() => {});
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
    }

    // Log to bot status channel
    const statusChannel = await client.channels.fetch(process.env.BOT_STATUS_CHANNEL_ID).catch(() => null);
    if (statusChannel) {
      const embed = new EmbedBuilder()
        .setTitle(`❌ Error in /${interaction.commandName}`)
        .addFields({
          name: 'Error Message',
          value: `\`\`\`${(err.stack || err.message || err.toString()).slice(0, 1000)}\`\`\``,
        })
        .setColor(0xff0000)
        .setTimestamp();

      await statusChannel.send({ embeds: [embed] }).catch(console.error);
    }
  }
});

  async function setOfflineStatus() {
    try {
        const channelId = process.env.STATUS_CHANNEL_ID || process.env.BOT_STATUS_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            const messages = await channel.messages.fetch({ limit: 10 });
            const msg = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === '🤖 Bot Status');
            
            const offlineEmbed = new EmbedBuilder()
                .setTitle('🤖 Bot Status')
                .setColor(0xED4245) // Red
                .addFields(
                    { name: 'Status', value: '`OFFLINE`', inline: true },
                    { name: 'Last Updated', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                );
            if (msg) {
                await msg.edit({ embeds: [offlineEmbed] });
            }
        }
    } catch (e) {
        console.error('Failed to set offline status:', e);
    }
  }

  process.on('SIGINT', async () => {
      console.log('[Shutdown] Bot is shutting down...');
      await setOfflineStatus();
      process.exit(0);
  });

  process.on('SIGTERM', async () => {
      console.log('[Shutdown] Bot is shutting down...');
      await setOfflineStatus();
      process.exit(0);
  });

  function loadCommands(dir) {
    const commands = new Collection();
    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files.flatMap(entry =>
      entry.isDirectory()
        ? getAllJSFiles(path.join(dir, entry.name))
        : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []
    )) {
      const command = require(file);
      if (command.data?.name && command.execute) {
        commands.set(command.data.name, command);
      }
    }

    return commands;
  }

  function getAllJSFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? getAllJSFiles(path.join(dir, entry.name))
        : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []
    );
  }

  function loadEventHandlers(client, eventsDir) {
    const files = fs.readdirSync(eventsDir).filter((file) => file.endsWith('.js'));
    for (const file of files) {
      const event = require(path.join(eventsDir, file));
      const handler = (...args) => event.execute(...args);
      event.once ? client.once(event.name, handler) : client.on(event.name, handler);
    }
  }

  async function cleanStaleGameChannels(client) {
    const guild = client.guilds.cache.first();
    if (!guild) return;
    const allChannels = await guild.channels.fetch();
    const activeGames = await getActiveGames();

    await Promise.all(activeGames.map(async (match) => {
      const gameId = match.gameId;
      const category = await guild.channels.fetch(match.categoryId).catch(() => null);
      if (!category) return;

      const children = category.children?.cache ?? allChannels.filter((c) => c.parentId === category.id);
      const isEmpty = [...children.values()].every((c) => c.isVoiceBased() && c.members.size === 0);

      if (isEmpty) {
        await Promise.all([...children.values()].map(c => c.delete().catch(console.error)));
        await category.delete().catch(console.error);
        await deleteActiveGame(gameId);
      }
    }));
  }
})();
