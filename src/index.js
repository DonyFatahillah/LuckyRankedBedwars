(async () => {
  require('dotenv').config({ path: __dirname + '/../.env' });

  const { Client, IntentsBitField, ActivityType, Collection, EmbedBuilder } = require('discord.js');
  const fs = require('fs');
  const path = require('path');
  const addBedBrokenField = require('./scripts/addBedBreakField');
  const { loadParties } = require('./utils/partySystem');
  const { cleanupExpiredPunishments } = require('./utils/punishmentManager');

  let loadLogs, cleanMatchLogs, getActiveGames, loadActiveGames, deleteActiveGame;
  try {
    ({ loadLogs } = require('./utils/matchLogger'));
    cleanMatchLogs = require('./scripts/cleanupMatchLogs');
      
    ({ getActiveGames, loadActiveGames, deleteActiveGame } = require('./queue/queueManager'));
    console.log('[Startup] ✅ Successfully loaded all required modules');
  } catch (err) {
    console.error('[FATAL] ❌ Error loading required modules:', err);
    process.exit(1);
  }
  loadParties();

  addBedBrokenField();

  cleanMatchLogs();
  console.log('[Startup] Bot is initializing...');

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

  try {
    client.commands = loadCommands(path.join(__dirname, 'commands'));
    console.log('[Startup] ✅ Commands loaded');
  } catch (err) {
    console.error('[Startup] ❌ Failed to load commands:', err);
    process.exit(1);
  }

  try {
    console.log('[Startup] Loading active games...');
    loadActiveGames();
    console.log('[Startup] ✅ Active games loaded');
  } catch (err) {
    console.error('[Startup] ❌ Failed to load active games:', err);
    process.exit(1);
  }

  try {
    console.log('[Startup] Loading match logs...');
    loadLogs();
    console.log('[Startup] ✅ Match logs loaded');
  } catch (err) {
    console.error('[Startup] ❌ Failed to load match logs:', err);
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

      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Status')
        .setTimestamp();

      if (type === 'online') {
        embed.setDescription('🟢 Bot is **online** and ready.')
          .setColor(0x00ff00);
      } else if (type === 'shutdown') {
        embed.setDescription('🔴 Bot is **shutting down**.')
          .setColor(0xff9900);
      } else if (type === 'crash') {
        embed.setDescription('❌ Bot **crashed with an error**.')
          .setColor(0xff0000)
          .addFields({
            name: 'Error',
            value: `\`\`\`${(err || '').toString().slice(0, 1000)}\`\`\``
          });
      }

      await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('[Status Embed Error]', e);
    }
  }

  client.once('ready', async () => {
    try {
      console.log(`[Startup] Ready event triggered as ${client.user.tag}`);
      console.log("Bot token exist:", client.token ? "✅ Yes" : "❌ No");

      const commandsArray = client.commands.map(cmd => cmd.data.toJSON());

      if (process.env.GUILD_ID) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        await guild.commands.set(commandsArray);
        console.log(`✅ Registered slash commands to guild: ${guild.name}`);
      } else {
        await client.application.commands.set(commandsArray);
        console.log('✅ Registered global slash commands');
      }

      client.user.setActivity({
        name: 'LuckyNetwork Ranked Bedwars',
        type: ActivityType.Watching,
      });

      await cleanStaleGameChannels(client);
      await cleanupExpiredPunishments(client);
      setInterval(() => cleanupExpiredPunishments(client), 30_000);  

      await sendStatusEmbed('online');

    } catch (err) {
      console.error('[FATAL] Error inside ready block:', err);
      await sendStatusEmbed('crash', err);
      process.exit(1);
    }
  });

  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error('[FATAL] Failed to login:', err);
    await sendStatusEmbed('crash', err);
    process.exit(1);
  }

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`[Command Error] /${interaction.commandName}:`, err);

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ An error occurred while executing this command.',
            ephemeral: true,
          }).catch(() => {});
        }

        // Log to bot status channel
        const statusChannel = await client.channels.fetch(process.env.BOT_STATUS_CHANNEL_ID).catch(() => null);
        if (statusChannel) {
          const embed = new EmbedBuilder()
            .setTitle(`❌ Error in /${interaction.commandName}`)
            .setDescription('An error occurred while executing a command.')
            .addFields({
              name: 'Error Message',
              value: `\`\`\`${(err.stack || err.message || err.toString()).slice(0, 1000)}\`\`\``,
            })
            .setColor(0xff0000)
            .setTimestamp();

          await statusChannel.send({ embeds: [embed] }).catch(console.error);
        }
      }
    }

    // Autocomplete
    else if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command || !command.autocomplete) return;

      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(`[Autocomplete Error] /${interaction.commandName}:`, err);

        // Optionally log autocomplete errors to bot status channel
        const statusChannel = await client.channels.fetch(process.env.BOT_STATUS_CHANNEL_ID).catch(() => null);
        if (statusChannel) {
          const embed = new EmbedBuilder()
            .setTitle(`⚠️ Autocomplete Error in /${interaction.commandName}`)
            .setDescription('An error occurred while processing autocomplete.')
            .addFields({
              name: 'Error Message',
              value: `\`\`\`${(err.stack || err.message || err.toString()).slice(0, 1000)}\`\`\``,
            })
            .setColor(0xffa500)
            .setTimestamp();

          await statusChannel.send({ embeds: [embed] }).catch(console.error);
        }
      }
    }
  } catch (err) {
    console.error('[Interaction Error]', err);
  }
});
    


  process.on('SIGINT', async () => {
    console.log('[Shutdown] Bot is shutting down...');
    await sendStatusEmbed('shutdown');
    process.exit();
  });
    
  process.on('SIGTERM', async () => {
  console.log('[Shutdown] SIGTERM received (likely from Pterodactyl panel).');
  await sendStatusEmbed('shutdown');
  process.exit();
});  

  process.on('uncaughtException', async (err) => {
    console.error('[UncaughtException]', err);
    await sendStatusEmbed('crash', err);
    process.exit(1);
  });

  process.on('unhandledRejection', async (err) => {
    console.error('[UnhandledRejection]', err);
    await sendStatusEmbed('crash', err);
    process.exit(1);
  });

  // ---------- Helper Functions ----------

  function loadCommands(dir) {
    const commands = new Collection();
    const files = getAllJSFiles(dir);
    console.log(`[Startup] Found ${files.length} command files.`);

    for (const file of files) {
      try {
        console.log(`[Startup] Loading command: ${file}`);
          
        const command = require(file);
        console.log(`[Startup] Registering command: ${command.data.name}`);

        if (command.data?.name && command.execute) {
          commands.set(command.data.name, command);
        }

        if (command.contextData?.name && command.contextExecute) {
          commands.set(command.contextData.name, command);
        }
      } catch (err) {
        console.error(`[Startup] ❌ Failed to load command ${file}:`, err);
        throw err;
      }
    }

    return commands;
  }

  function getAllJSFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.flatMap(entry =>
      entry.isDirectory()
        ? getAllJSFiles(path.join(dir, entry.name))
        : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []
    );
    console.log(`[Startup] Command file list:`, files);
    return files;
  }

  function loadEventHandlers(client, eventsDir) {
    const files = fs.readdirSync(eventsDir).filter(file => file.endsWith('.js'));

    for (const file of files) {
      const event = require(path.join(eventsDir, file));
      const handler = (...args) => event.execute(...args);
      event.once ? client.once(event.name, handler) : client.on(event.name, handler);
    }
  }

  async function cleanStaleGameChannels(client) {
    const guild = client.guilds.cache.first();
    const allChannels = await guild.channels.fetch();
    const activeGames = getActiveGames();

    for (const [gameId, match] of activeGames.entries()) {
      const category = await guild.channels.fetch(match.categoryId).catch(() => null);
      if (!category) continue;

      const children = category.children?.cache ?? allChannels.filter(c => c.parentId === category.id);
      const isEmpty = [...children.values()].every(c => c.isVoiceBased() && c.members.size === 0);

      if (isEmpty) {
        console.log(`[Startup Cleanup] Deleting empty game category ${category.name} (#${gameId})`);

        for (const [, channel] of children) {
          await channel.delete().catch(console.error);
        }

        await category.delete().catch(console.error);
        deleteActiveGame(gameId);
      }
    }
  }
})().catch(async (err) => {
  console.error('[FATAL] Top-level crash:', err);
  try {
    // Try to send a crash embed if possible
    if (typeof client !== 'undefined') {
      const channel = await client.channels.fetch(process.env.BOT_STATUS_CHANNEL_ID);
      const embed = new EmbedBuilder()
        .setTitle('❌ Bot crashed during startup')
        .setColor(0xff0000)
        .setDescription('Bot failed during initialization.')
        .addFields({ name: 'Error', value: `\`\`\`${(err || '').toString().slice(0, 1000)}\`\`\`` })
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }
  } catch (embedErr) {
    console.error('[Embed Send Failed]', embedErr);
  }
  process.exit(1);
});
