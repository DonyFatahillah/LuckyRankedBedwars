// src/commands/admin/sendrules.js
const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    PermissionFlagsBits 
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendrules')
        .setDescription('Send the server rules embed.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
        }

        // Send directly without deferReply or ephemeral
        const embed1 = new EmbedBuilder()
            .setTitle('📌 Server Rules & Guidelines')
            .setDescription(
                'Welcome to our community! By joining and remaining in this server, you agree to abide by these rules, as well as the official Discord Terms of Service (ToS) and Community Guidelines.'
            )
            .setColor('#FF4500');

        const embed2 = new EmbedBuilder()
            .setTitle('General Server Rules')
            .addFields(
                { name: 'Failing To Uphold Discord’s ToS', value: 'Any activity involving illegal content, self-harm promotion, or child safety issues will result in an immediate, permanent ban and may be reported. Read more https://discord.com/guidelines' },
                { name: 'Hate Speech & Excessive Hostility', value: 'Using hate speech, being excessively hostile, or engaging in targeted harassment, bullying, or personal attacks.' },
                { name: 'Doxing & Leaking PII', value: 'Sharing, threatening to share, or leaking private, personally identifiable information without consent.' },
                { name: 'Impersonation & Staff Abuse', value: 'Impersonating members or staff, or attempting to bribe/coerce staff.' },
                { name: 'Spam & Disruptive Behavior', value: 'Excessive spam, tagging, or disruptive audio/behavior in Voice Channels (VCs).' },
                { name: 'Advertising & Promotion', value: 'Unsolicited advertising outside designated channels is prohibited.' },
                { name: 'Harmful Content', value: 'Sending malicious links or graphic/shock content.' },
                { name: 'NSFW Content', value: 'Posting sexually explicit or violent content outside marked NSFW channels.' },
                { name: 'Inappropriate Accounts', value: 'Using slurs, profanity, or graphic imagery in names or avatars.' },
                { name: 'Politics/Religion', value: 'Discussions concerning sensitive or controversial real-world politics or religion are prohibited outside of designated channels (if they exist) to maintain a focused and peaceful environment.'}
            )
            .setColor('#FF6347');

        const embed3 = new EmbedBuilder()
            .setTitle('Game & Community Specific Conduct')
            .addFields(
                { name: 'Fair Play Policy', value: 'Cheating (blacklisted clients, macros), bug exploiting, or banned items/features is strictly prohibited.' },
                { name: 'Intentional Throwing or Boosting', value: 'Intentionally losing a match, attempting to bribe players to throw, boosting ranks, or queue dodging.' },
                { name: 'Voice Communication', value: 'Disconnecting, AFKing, or intentionally deafening in mandatory Voice Channels during competitive games.' },
                { name: 'Reporting Evidence', value: 'Submitting invalid or manipulated screenshots or evidence when reporting a match or player is prohibited.' },
                { name: 'Account Integrity (No Alt-ing/Sharing)', value: 'Account sharing is strictly prohibited. You may only use one active account for competitive play or activities (i.e., using two accounts simultaneously is forbidden). Evading a ban with an alternate account will result in a permanent ban for all associated accounts.'}
            )
            .setColor('#FFA500');

        const embed4 = new EmbedBuilder()
            .setTitle('Enforcement & Reporting')
            .addFields(
                { name: 'Reporting', value: 'Do not attempt to moderate situations yourself. Notify a moderator immediately or use the dedicated support channels.' },
                { name: 'Consequences', value: 'Violations will result in zero-tolerance action, including permanent bans. Minor infractions may follow a strike system.' },
                { name: 'Game Voiding', value: 'Games can be voided if scored incorrectly, if cheating/exploiting occurred, intentional throws/boosts, or server lag significantly impacted results.' }
            )
            .setColor('#FF8C00');

        await interaction.channel.send({
            content: '📢 Server Rules & Guidelines',
            embeds: [embed1, embed2, embed3, embed4]
        });
    }
};
