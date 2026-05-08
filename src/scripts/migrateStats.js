const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client, IntentsBitField } = require('discord.js');

const STATS_PATH = path.join(__dirname, '../../data/playerStats.json');

async function migrate() {
  const client = new Client({
    intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMembers],
  });

  await client.login(process.env.DISCORD_TOKEN);

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const members = await guild.members.fetch();

  if (!fs.existsSync(STATS_PATH)) {
    console.error('playerStats.json not found');
    process.exit(1);
  }

  const stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  const newStats = {};

  for (const userId in stats) {
    const member = members.get(userId);
    const oldData = stats[userId];

    // Create new structure
    const newData = { ...oldData };
    
    // Set discordUsername from member if exists and not a bot
    if (member && !member.user.bot) {
      newData.discordUsername = member.user.username;
    } else {
      // Fallback to old username if member not found or is a bot, or null
      newData.discordUsername = oldData.username || null;
    }

    newData.ingameUsername = null;
    delete newData.username;

    newStats[userId] = newData;
  }

  fs.writeFileSync(STATS_PATH, JSON.stringify(newStats, null, 2));
  console.log('✅ Migration complete: Updated playerStats.json structure.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
