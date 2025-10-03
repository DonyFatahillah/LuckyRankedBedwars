const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    AttachmentBuilder,
    PermissionFlagsBits 
} = require('discord.js');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendverify')
        .setDescription('Send the verification instructions embed.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // only admins can use it

    async execute(interaction) {
        // Just in case: double-check permission at runtime
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: '❌ You do not have permission to use this command.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        // File attachments
        const banner = new AttachmentBuilder(path.join(__dirname, '../../assets/verify_banner.png'));
        const icon = new AttachmentBuilder(path.join(__dirname, '../../assets/verify_icon.png'));
        const verifytutorial = new AttachmentBuilder(path.join(__dirname, '../../assets/verify_tutorial.png'));

        const verifyEmbed = new EmbedBuilder()
            .setTitle('✅ How to Verify')
            .setDescription(
                `Welcome to the server!\n\n` +
                `To access all channels, you need to complete verification.\n\n` +
                "To verify, type the command `/verify <nickname> <screenshot>`\n\n"
            )
            .setColor('#FFA500')
            .setThumbnail('attachment://verify_icon.png')
            .setImage('attachment://verify_tutorial.png')
        
        const exampleVerify = new EmbedBuilder()
            .setTitle('Example Verification')   
            .setColor('#FFA500') 
            .setImage('attachment://verify_banner.png')
            .setDescription(
                `Make sure that the screenshot is taken on LuckyNetwork Bedwars Lobby and it shows your Discord tag like this:\n\n`
            )



                    // Send the panel to the channel
        await interaction.channel.send({
            embeds: [verifyEmbed, exampleVerify],
            files: [banner, icon, verifytutorial]
        });

    }
};
