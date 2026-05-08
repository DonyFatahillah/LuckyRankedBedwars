const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const Player = require('../../models/Player');
require('dotenv').config();

const {
  createParty,
  disbandParty,
  getPartyByUser,
  getPartyByLeader,
  leaveParty,
  promoteLeader,
  inviteToParty,
  acceptInvite,
  getAllParties
} = require('../../utils/partySystem');

const { isPartyMatch } = require('../../utils/partyModeManager');

const LIMIT_PATH = path.join(__dirname, '../../../data/partyLimit.json');

const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
const clientId = process.env.CLIENT_ID;

// Helper function
function isValidTarget(member) {
  return member && member.id !== clientId && member.roles.cache.has(verifiedRoleId);
}

let globalPartyLimit = 2;
if (fs.existsSync(LIMIT_PATH)) {
  try {
    const data = JSON.parse(fs.readFileSync(LIMIT_PATH, 'utf-8'));
    if (data.limit && Number.isInteger(data.limit)) globalPartyLimit = data.limit;
  } catch (e) {
    console.error('[PartyLimit] Failed to load:', e);
  }
}

function saveGlobalLimit(limit) {
  fs.writeFileSync(LIMIT_PATH, JSON.stringify({ limit }, null, 2));
  globalPartyLimit = limit;
}

async function buildPartyInfoEmbed(party, guild, titleOverride = null) {
  const memberMentions = await Promise.all(party.members.map(async (id) => {
    try {
      const member = await guild.members.fetch(id);
      const player = new Player(member);
      return `• **${player.username}**`;
    } catch {
      return `• **<@${id}>**`;
    }
  }));

  let leaderName = `<@${party.leaderId}>`;
  try {
    const leader = await guild.members.fetch(party.leaderId);
    const leaderPlayer = new Player(leader);
    leaderName = leaderPlayer.username;
  } catch {}

  return new EmbedBuilder()
    .setTitle(titleOverride || `📦 Party of ${leaderName}`)
    .setColor(0x2F3136)
    .setDescription([
      `Created <t:${Math.floor(party.createdAt / 1000)}:R>`,
      `Auto Warp: \`${party.autowarp ? 'true' : 'false'}\``,
      `Private: \`${!party.public}\``,
      ``,
      `**Party Leader**`,
      `**${leaderName}**`,
      ``,
      `**Party Members [${party.members.length}/${party.maxMembers}]**`,
      memberMentions.join('\n')
    ].join('\n'));
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
    .addSubcommand(cmd => cmd.setName('autowarp').setDescription('Toggle AutoWarp')
      .addStringOption(opt => opt.setName('state').setDescription('Enable or disable').setRequired(true)
        .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })))
    .addSubcommand(cmd => cmd.setName('privacy').setDescription('Set party to private or public')
      .addStringOption(opt => opt.setName('type').setDescription('Privacy mode').setRequired(true)
        .addChoices({ name: 'Private', value: 'private' }, { name: 'Public', value: 'public' })))
    .addSubcommand(cmd => cmd.setName('list').setDescription('List all parties (admin only)'))
    .addSubcommand(cmd => cmd.setName('disbandall').setDescription('Disband all parties (admin only)')),

  async execute(interaction) {
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    let party = getPartyByUser(userId);

    if (!isPartyMatch()) {
      return interaction.reply({ content: '⚠️ Party Mode is currently disabled.', ephemeral: false });
    }

    switch (sub) {
      case 'create': {
        if (party) return interaction.reply({ content: '❌ You are already in a party.', ephemeral: false });
        const newParty = createParty(userId);
        const embed = await buildPartyInfoEmbed(newParty, guild);
        return interaction.reply({ content: '✅ Party created!', embeds: [embed], ephemeral: false });
      }

      case 'invite': {
        const targetUser = interaction.options.getUser('user');
        await interaction.deferReply({ ephemeral: false });
          
        
          const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

          if (!isValidTarget(targetMember)) {
            return interaction.reply({ content: '❌ Sorry but we can’t find that user.', ephemeral: true });
          } 

        if (targetUser.id === userId)
          return interaction.followUp({ content: '❌ You cannot invite yourself.' });

        if (!party) {
          party = createParty(userId);
          const embed = await buildPartyInfoEmbed(party, guild);
          await interaction.editReply({ content: '✅ No party found. Party created automatically!', embeds: [embed] });
        }

        if (!party.isLeader(userId)) {
          return interaction.followUp({ content: '❌ You must be the party leader to invite.' });
        }

        const targetParty = getPartyByUser(targetUser.id);
        if (targetParty && targetParty.leaderId !== userId) leaveParty(targetUser.id);

        const success = inviteToParty(userId, targetUser.id);
        if (!success) return interaction.followUp({ content: '❌ Failed to invite user. They may already be invited or party is full.' });

        await interaction.followUp({ content: `✅ Invited <@${targetUser.id}> to your party.` });

        try {
          await targetUser.send({
            content: `📬 You were invited to a party by <@${userId}>!\nUse \`/party join @${interaction.user.username}\` to join.`
          });
        } catch {
          await interaction.followUp({ content: '⚠️ User was invited but could not be DMed.' });
        }
        break;
      }

      case 'join': {
        const leader = interaction.options.getUser('leader');

        if (leader.id === userId)
          return interaction.reply({ content: '❌ You cannot join your own party.', ephemeral: false });

        const targetParty = getPartyByLeader(leader.id);
        if (!targetParty)
          return interaction.reply({ content: '❌ That party doesn’t exist.', ephemeral: false });

        const isInvited = targetParty.invited.includes(userId);
        const isPublic = targetParty.public;

        if (!isInvited && !isPublic) {
          return interaction.reply({ content: '❌ This party is private. You need an invite to join.', ephemeral: false });
        }

        const currentParty = getPartyByUser(userId);
        if (currentParty && currentParty.leaderId !== leader.id) leaveParty(userId);

        const success = acceptInvite(userId, leader.id);
        if (!success)
          return interaction.reply({ content: '❌ Failed to join the party.', ephemeral: false });

        const updatedParty = getPartyByLeader(leader.id);
        const embed = await buildPartyInfoEmbed(updatedParty, guild);

        return interaction.reply({
          content: `✅ <@${userId}> joined <@${leader.id}>'s party.`,
          embeds: [embed],
          ephemeral: false
        });
      }

      case 'leave': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: false });
        const result = leaveParty(userId);
        const msg = result === 'disbanded'
          ? '✅ You left the party. The party has been disbanded.'
          : '✅ You left the party.';
        return interaction.reply({ content: msg, ephemeral: false });
      }

      case 'disband': {
        if (!party || !party.isLeader(userId)) {
          return interaction.reply({ content: '❌ You must be the party leader to disband.', ephemeral: false });
        }
        disbandParty(userId);
        return interaction.reply({ content: '✅ Party disbanded.', ephemeral: false });
      }

      case 'kick': {
        if (!party || !party.isLeader(userId)) {
          return interaction.reply({ content: '❌ You must be the leader to kick members.', ephemeral: false });
        }

        const target = interaction.options.getUser('user');
        if (!party.isMember(target.id)) return interaction.reply({ content: '❌ That user is not in your party.', ephemeral: false });
        if (target.id === userId) return interaction.reply({ content: '❌ You can’t kick yourself.', ephemeral: false });

        party.removeMember(target.id);
        return interaction.reply({ content: `✅ <@${target.id}> has been kicked.`, ephemeral: false });
      }

      case 'promote': {
        if (!party || !party.isLeader(userId)) return interaction.reply({ content: '❌ Only the leader can promote.', ephemeral: false });

        const target = interaction.options.getUser('user');
        if (!party.isMember(target.id)) return interaction.reply({ content: '❌ That user is not in your party.', ephemeral: false });

        const success = promoteLeader(userId, target.id);
        if (!success) return interaction.reply({ content: '❌ Failed to promote member.', ephemeral: false });

        return interaction.reply({ content: `✅ <@${target.id}> is now the party leader.`, ephemeral: false });
      }

      case 'info': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: false });
        const embed = await buildPartyInfoEmbed(party, guild);
        return interaction.reply({ embeds: [embed], ephemeral: false });
      }

      case 'slot': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: false });
        if (!party.isLeader(userId)) return interaction.reply({ content: '❌ Only the leader can set the slot.', ephemeral: false });

        const slotCount = interaction.options.getInteger('number');

        if (slotCount > globalPartyLimit) {
          return interaction.reply({
            content: `❌ You cannot set more than the current global limit of **${globalPartyLimit}** members.`,
            ephemeral: false
          });
        }

        party.maxMembers = slotCount;
        return interaction.reply({ content: `✅ Party slot count set to **${slotCount}**.`, ephemeral: false });
      }

      case 'setlimit': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '❌ Only admins can set the global party slot limit.', ephemeral: false });
        }

        const newLimit = interaction.options.getInteger('number');
        if (newLimit < 1) return interaction.reply({ content: '❌ Limit must be at least 1.', ephemeral: false });

        saveGlobalLimit(newLimit);
        return interaction.reply({ content: `✅ Global party slot limit set to **${newLimit}**.`, ephemeral: false });
      }

      case 'autowarp': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: false });
        if (!party.isLeader(userId)) return interaction.reply({ content: '❌ Only the party leader can change this setting.', ephemeral: false });

        const state = interaction.options.getString('state') === 'on';
        party.setAutoWarp(state);

        if (state) {
          const leaderMember = await interaction.guild.members.fetch(userId).catch(() => null);
          if (leaderMember && leaderMember.voice.channel) {
            for (const memberId of party.members) {
              if (memberId === userId) continue;
              const member = await interaction.guild.members.fetch(memberId).catch(() => null);
              if (member && member.voice.channelId !== leaderMember.voice.channelId) {
                await member.voice.setChannel(leaderMember.voice.channel).catch(() => {});
              }
            }
          }
        }

        return interaction.reply({
          content: `✅ AutoWarp is now **${state ? 'enabled' : 'disabled'}**.`,
          ephemeral: false
        });
      }

      case 'privacy': {
        if (!party) return interaction.reply({ content: '❌ You are not in a party.', ephemeral: false });
        if (!party.isLeader(userId)) return interaction.reply({ content: '❌ Only the leader can change privacy.', ephemeral: false });

        const type = interaction.options.getString('type');
        party.public = type === 'public';
        return interaction.reply({ content: `✅ Party privacy set to **${type}**.`, ephemeral: false });
      }

      case 'list': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '❌ Only admins can view all parties.', ephemeral: false });
        }

        const parties = getAllParties();
        if (!parties.length) return interaction.reply({ content: '⚠️ No active parties.', ephemeral: false });

        const embed = new EmbedBuilder().setTitle('📜 Active Parties').setColor(0x2F3136);

        for (const p of parties) {
          try {
            const members = await Promise.all(p.members.map(async id => {
              const m = await interaction.guild.members.fetch(id).catch(() => null);
              return m ? new Player(m).username : `<@${id}>`;
            }));
            const leader = await interaction.guild.members.fetch(p.leaderId).catch(() => null);
            const leaderName = leader ? new Player(leader).username : `<@${p.leaderId}>`;
            embed.addFields({ name: `${leaderName} (Leader)`, value: members.join(', '), inline: false });
          } catch {}
        }

        return interaction.reply({ embeds: [embed], ephemeral: false });
      }

      case 'disbandall': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '❌ Only admins can disband all parties.', ephemeral: false });
        }

        const parties = getAllParties();
        parties.forEach(p => disbandParty(p.leaderId));

        return interaction.reply({ content: `✅ All ${parties.length} parties have been disbanded.`, ephemeral: false });
      }
    }
  }
};
