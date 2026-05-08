require("dotenv").config({ path: __dirname + "/../.env" });
const fs = require('fs');
const path = require('path');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;

console.log("Client ID:", CLIENT_ID);
console.log("Guild ID:", GUILD_ID);
console.log("Bot Token:", DISCORD_TOKEN ? "✅ Token ditemukan" : "❌ Token tidak ditemukan");

function getAllFiles(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    let commandFiles = [];

    for (const file of files) {
        if (file.isDirectory()) {
            commandFiles = [...commandFiles, ...getAllFiles(path.join(dir, file.name))];
        } else if (file.name.endsWith('.js')) {
            commandFiles.push(path.join(dir, file.name));
        }
    }
    return commandFiles;
}

let commands = [];

const commandFiles = getAllFiles(path.join(__dirname, "commands"));
for (const file of commandFiles) {
    const command = require(file);

    if (command.slashData) {
        commands.push(command.slashData.toJSON());
    }

    if (command.contextData) {
        commands.push(command.contextData.toJSON());
    }

    // backward compatibility if you're still using command.data
    if (command.data) {
        commands.push(command.data.toJSON());
    }
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
    try {
        console.log(`🔄 Refreshing ${commands.length} application commands (slash + context menus)...`);

        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );

        console.log("✅ Successfully updated application commands.");
    } catch (error) {
        console.error("❌ Failed to update commands:", error);
    }
})();
