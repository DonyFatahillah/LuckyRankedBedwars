const { EmbedBuilder } = require('discord.js');
require('dotenv').config();

async function logStaffCommand(interaction) {
  const STAFF_CMD_LOGS_CHANNEL_ID = process.env.STAFF_CMD_LOGS_CHANNEL_ID;
  if (!STAFF_CMD_LOGS_CHANNEL_ID) return;

  const guild = interaction.guild;
  if (!guild) return;

  const channel = await guild.channels.fetch(STAFF_CMD_LOGS_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const user = interaction.user;

  const embed = new EmbedBuilder()
    .setTitle('🛠️ Staff Command Executed')
    .setDescription(`**/${interaction.commandName}**`)
    .addFields(
      { name: 'User', value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: 'Channel', value: `<#${interaction.channelId}>`, inline: true }
    )
    .setTimestamp()
    .setColor(0x7289da);

  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { logStaffCommand };
