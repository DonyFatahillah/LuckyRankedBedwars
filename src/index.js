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
  const syncVerifiedUsers = require('./scripts/syncVerifiedUsers');
  const auditUsers = require('./scripts/auditUsers');
  const {cleanInvalidMessages} = require('./events/messageCreatePacks')
  const connectDB = require('./config/database');
  const { setupResultListener } = require('./utils/redisClient');

  let loadLogs, cleanMatchLogs, getActiveGames, loadActiveGames, deleteActiveGame, checkAllQueueChannelsOnStartup;

  try {
    await connectDB();
    // Run maintenance tasks in background
    syncVerifiedUsers().catch(console.error);
    auditUsers().catch(console.error);

    ({ loadLogs } = require('./utils/matchLogger'));
    cleanMatchLogs = require('./scripts/cleanupMatchLogs');

    const queueManager = require('./queue/queueManager');
    ({ getActiveGames, loadActiveGames, deleteActiveGame, checkAllQueueChannelsOnStartup } = queueManager);

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
      const channel = await client.channels.fetch(process.env.BOT_STATUS_CHANNEL_ID);
      if (!channel) return;

      const embed = new EmbedBuilder().setTitle('🤖 Bot Status').setTimestamp();

      if (type === 'online') {
        embed.setDescription('🟢 Bot is **online** and ready.').setColor(0x00ff00);
      } else if (type === 'shutdown') {
        embed.setDescription('🔴 Bot is **shutting down**.').setColor(0xff9900);
      } else if (type === 'crash') {
        embed
          .setDescription('❌ Bot **crashed with an error**.')
          .setColor(0xff0000)
          .addFields({ name: 'Error', value: `\`\`\`${(err || '').toString().slice(0, 1000)}\`\`\`` });
      }

      await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('[Status Embed Error]', e);
    }
  }

  client.once('ready', async () => {
    try {
      console.log(`[Startup] Ready event triggered as ${client.user.tag}`);


  // ✅ Confirm pending submitted matches // Preload display names

      const commandsArray = client.commands.map((cmd) => cmd.data.toJSON());

      if (process.env.GUILD_ID) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID); 
        await guild.commands.set(commandsArray);

        console.log('[Startup] Fetching guild members...');
        const members = await guild.members.fetch({ withPresences: false });

        await displayNameCache.refresh(client, members);
        await mapPicker.loadMapList();
        await cleanInvalidMessages(client);  
          
        await runCleanup(client, members);
        await syncRanks(client, members);  
         await autoConfirmPendingMatches(client);  
        console.log(`✅ Registered slash commands to guild: ${guild.name}`);
      } else {
        await client.application.commands.set(commandsArray);
        console.log('✅ Registered global slash commands');
      }

      client.user.setActivity({
        name: 'LuckyNetwork Ranked Bedwars',
        type: ActivityType.Watching,
      });

      // Task runner
      const maintenanceTask = require('./tasks/maintenance');
      await maintenanceTask.execute(client);

      setupResultListener(client);

      await sendStatusEmbed('online');
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

  process.on('SIGINT', async () => {
    console.log('[Shutdown] Bot is shutting down...');
    await sendStatusEmbed('shutdown');
    process.exit();
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
