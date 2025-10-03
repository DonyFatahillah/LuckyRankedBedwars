const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const {
  createParty,
  disbandParty,
  getPartyByUser,
  getPartyByLeader,
  leaveParty,
  promoteLeader,
  inviteToParty,
  acceptInvite,
} = require('../../utils/partySystem');

const { isPartyMatch } = require('../../utils/partyModeManager');

// Path for global party limit
const LIMIT_PATH = path.join(__dirname, '../../../data/partyLimit.json');

// Load persisted limit
let globalPartyLimit = 2; // default
if (fs.existsSync(LIMIT_PATH)) {
  try {
    const data = JSON.parse(fs.readFileSync(LIMIT_PATH, 'utf-8'));
    if (data.limit && Number.isInteger(data.limit)) globalPartyLimit = data.limit;
  } catch (e) {
    console.error('[PartyLimit] Failed to load:', e);
  }
}

// Save function
function saveGlobalLimit(limit) {
  fs.writeFileSync(LIMIT_PATH, JSON.stringify({ limit }, null, 2));
  globalPartyLimit = limit;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('party')
    .setDescription('Party system for Ranked Bedwars')
    .addSubcommand(cmd => cmd.setName('create').setDescription('Create a new party'))
    .addSubcommand(cmd => cmd.setName('invite').setDescription('Invite a player to your party')
      .addUserOption(opt => opt.setName('user').setDescription('User to invite').setRequired(true)))
    .addSubcommand(cmd => cmd.setName('join').setDescription('Join a party')
      .addUserOption(opt => opt.setName('leader').setDescription('Party leader').setRequired(true)))
    .addSubcommand(cmd => cmd.setName('leave').setDescription('Leave your current party'))
    .addSubcommand(cmd => cmd.setName('disband').setDescription('Disband your party (leader only)'))
    .addSubcommand(cmd => cmd.setName('kick').setDescription('Kick a party member')
      .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true)))
    .addSubcommand(cmd => cmd.setName('promote').setDescription('Transfer leadership to another party member')
      .addUserOption(opt => opt.setName('user').setDescription('User to promote').setRequired(true)))
    .addSubcommand(cmd => cmd.setName('info').setDescription('Show party details'))
    .addSubcommand(cmd => cmd.setName('slot').setDescription('Set the party slot count')
      .addIntegerOption(opt => opt.setName('number').setDescription('Number of slots').setRequired(true)))
    .addSubcommand(cmd => cmd.setName('setlimit').setDescription('Set the global party slot limit (admin only)')
      .addIntegerOption(opt => opt.setName('number').setDescription('Limit').setRequired(true)))
    .addSubcommand(cmd => cmd.setName('autowarp').setDescription('Toggle AutoWarp (voice auto-follow to leader)')
      .addStringOption(opt => opt.setName('state').setDescription('Enable or disable').setRequired(true)
        .addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' },
        )))
    .addSubcommand(cmd => cmd.setName('privacy').setDescription('Set party to private or public')
      .addStringOption(opt => opt.setName('type').setDescription('Privacy mode').setRequired(true)
        .addChoices(
          { name: 'Private', value: 'private' },
          { name: 'Public', value: 'public' },
        ))),

  async execute(interaction) {
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (!isPartyMatch()) {
      return interaction.reply({ content: '⚠️ Party Mode is currently disabled.', ephemeral: true });
    }

    let party = getPartyByUser(userId);

    switch (sub) {
      case 'create':
        if (party) return interaction.reply({ content: '❌ You are already in a party.', ephemeral: true });
        createParty(userId);
        return interaction.reply({ content: '✅ Party created!', ephemeral: false });

      case 'invite': {
        const targetUser = interaction.options.getUser('user');
        if (!party) {
          party = createParty(userId);
          await interaction.deferReply({ ephemeral: true });
          await interaction.followUp({ content: '✅ No party found. Party created automatically!' });
        } else {
          await interaction.deferReply({ ephemeral: true });
        }

        if (!party.isLeader(userId)) {
          return interaction.followUp({ content: '❌ You must be the party leader to invite.' });
        }

        const success = inviteToParty(userId, targetUser.id);
        if (!success) {
          return interaction.followUp({ content: '❌ User is already in the party or invited.' });
        }

        await interaction.followUp({ content: `✅ Invited <@${targetUser.id}> to your party.` });

        try {
          await targetUser.send({
            content: `📬 You were invited to a party by <@${userId}>!\nUse \`/party join @${interaction.user.username}\` to join.`
          });
        } catch (err) {
          console.warn(`⚠️ Could not DM ${targetUser.tag}:`, err);
        }

        break;
      }

      case 'join': {
        const leader = interaction.options.getUser('leader');
        const targetParty = getPartyByLeader(leader.id);
        if (!targetParty) return interaction.reply({ content: '❌ That party doesn’t exist.', ephemeral: true });

        const isInvited = targetParty.invited.includes(userId);
        const isPublic = targetParty.public;

        if (!isInvited && !isPublic) {
          return interaction.reply({ content: '❌ This party is private. You need an invite to join.', ephemeral: true });
        }

        const success = acceptInvite(userId, leader.id);
        if (!success) return interaction.reply({ content: '❌ Failed to join the party.', ephemeral: true });

        return interaction.reply({ content: `✅ You joined <@${leader.id}>'s party.` });
      }

      case 'leave': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: true });
        const result = leaveParty(userId);
        const msg = result === 'disbanded'
          ? '✅ You left the party. The party has been disbanded.'
          : '✅ You left the party.';
        return interaction.reply({ content: msg });
      }

      case 'disband': {
        if (!party || !party.isLeader(userId)) {
          return interaction.reply({ content: '❌ You must be the party leader to disband.', ephemeral: true });
        }
        disbandParty(userId);
        return interaction.reply({ content: '✅ Party disbanded.' });
      }

      case 'kick': {
        if (!party || !party.isLeader(userId)) {
          return interaction.reply({ content: '❌ You must be the leader to kick members.', ephemeral: true });
        }

        const target = interaction.options.getUser('user');
        if (!party.isMember(target.id)) return interaction.reply({ content: '❌ That user is not in your party.', ephemeral: true });
        if (target.id === userId) return interaction.reply({ content: '❌ You can’t kick yourself.', ephemeral: true });

        party.removeMember(target.id);
        return interaction.reply({ content: `✅ <@${target.id}> has been kicked.` });
      }

      case 'promote': {
        if (!party || !party.isLeader(userId)) return interaction.reply({ content: '❌ Only the leader can promote.', ephemeral: true });

        const target = interaction.options.getUser('user');
        if (!party.isMember(target.id)) return interaction.reply({ content: '❌ That user is not in your party.', ephemeral: true });

        const success = promoteLeader(userId, target.id);
        if (!success) return interaction.reply({ content: '❌ Failed to promote member.', ephemeral: true });

        return interaction.reply({ content: `✅ <@${target.id}> is now the party leader.` });
      }

      case 'info': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: true });
        const memberMentions = party.members.map(id => `<@${id}>`);
        const embed = new EmbedBuilder()
          .setTitle('📦 Party System')
          .setColor(0x2F3136)
          .setDescription([
            `Created <t:${Math.floor(party.createdAt / 1000)}:R>`,
            `Auto Warp: \`${party.autowarp ? 'true' : 'false'}\``,
            `Private: \`${!party.public}\``,
            `Open: \`${party.public}\``,
            ``,
            `**Party Leader**`,
            `<@${party.leaderId}>`,
            ``,
            `**Party Members [${party.members.length}/${party.maxMembers}]**`,
            memberMentions.join('\n')
          ].join('\n'));
        return interaction.reply({ embeds: [embed], ephemeral: false });
      }

      case 'slot': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: true });
        if (!party.isLeader(userId)) return interaction.reply({ content: '❌ Only the leader can set the slot.', ephemeral: true });

        const slotCount = interaction.options.getInteger('number');

        // Enforce global limit
        if (slotCount > globalPartyLimit) {
          return interaction.reply({
            content: `❌ You cannot set more than the current global limit of **${globalPartyLimit}** members.`,
            ephemeral: true
          });
        }

        party.maxMembers = slotCount;
        return interaction.reply({ content: `✅ Party slot count set to **${slotCount}**.` });
      }

      case 'setlimit': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '❌ Only admins can set the global party slot limit.', ephemeral: true });
        }

        const newLimit = interaction.options.getInteger('number');
        if (newLimit < 1) return interaction.reply({ content: '❌ Limit must be at least 1.', ephemeral: true });

        saveGlobalLimit(newLimit);
        return interaction.reply({ content: `✅ Global party slot limit set to **${newLimit}**.` });
      }

case 'autowarp': {
  if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: true });
  if (!party.isLeader(userId)) return interaction.reply({ content: '❌ Only the party leader can change this setting.', ephemeral: true });

  const state = interaction.options.getString('state') === 'on';
  party.setAutoWarp(state);

  // Move all party members to leader's voice channel if enabled
  if (state) {
    const leaderMember = await interaction.guild.members.fetch(userId).catch(() => null);
    if (leaderMember && leaderMember.voice.channel) {
      for (const memberId of party.members) {
        if (memberId === userId) continue; // skip leader
        const member = await interaction.guild.members.fetch(memberId).catch(() => null);
        if (member && member.voice.channelId !== leaderMember.voice.channelId) {
          await member.voice.setChannel(leaderMember.voice.channel).catch(() => {});
        }
      }
    }
  }

  return interaction.reply({
    content: `✅ AutoWarp is now **${state ? 'enabled' : 'disabled'}**.`,
  });
}

      case 'privacy': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: true });
        if (!party.isLeader(userId)) return interaction.reply({ content: '❌ Only the leader can change privacy.', ephemeral: true });

        const type = interaction.options.getString('type'); // 'private' or 'public'
        party.public = type === 'public';
        return interaction.reply({ content: `✅ Party privacy set to **${type}**.` });
      }
    }
  }
};
