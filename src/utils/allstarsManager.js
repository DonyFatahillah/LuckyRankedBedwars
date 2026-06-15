const { redis, redisSub, getPlayerOnlineStatus } = require('./redisClient');
const Player = require('../models/Player');

/**
 * Sets up the Redis listener for Allstars tournament checks.
 * @param {import('discord.js').Client} client 
 */
function setupAllstarsListener(client) {
    const CHECK_CHANNEL = 'allstars.tournament.check';
    const CONFIRMED_CHANNEL = 'allstars.tournament.confirmed';
    const WAITING_ROOM_ID = process.env.WAITING_ROOM_VOICE_ID;

    console.log(`[Allstars] Subscribing to ${CHECK_CHANNEL}...`);
    redisSub.subscribe(CHECK_CHANNEL, (err) => {
        if (err) {
            console.error(`[Allstars] Failed to subscribe to ${CHECK_CHANNEL}:`, err);
        } else {
            console.log(`[Allstars] Successfully subscribed to ${CHECK_CHANNEL}`);
        }
    });

    redisSub.on('message', async (channel, message) => {
        if (channel !== CHECK_CHANNEL) return;

        try {
            const data = JSON.parse(message);
            
            if (data.action !== 'CHECK') {
                return;
            }

            const guildId = process.env.GUILD_ID;
            if (!guildId) {
                console.error('[Allstars] GUILD_ID not found in environment');
                return;
            }

            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                console.error(`[Allstars] Guild with ID ${guildId} not found`);
                return;
            }

            // Map team names to Voice IDs from environment (normalized to lowercase keys)
            const teamVoiceMapping = {
                "team1": process.env.TEAM_1_VOICE_ID,
                "team2": process.env.TEAM_2_VOICE_ID,
                "team3": process.env.TEAM_3_VOICE_ID,
                "team4": process.env.TEAM_4_VOICE_ID
            };

            const processTeam = async (teamName) => {
                if (!teamName) return [];
                
                // Normalize: remove spaces and convert to lowercase (e.g., "Team 1" -> "team1")
                const normalizedName = teamName.replace(/\s+/g, '').toLowerCase();
                const voiceId = teamVoiceMapping[normalizedName];
                
                if (!voiceId) {
                    console.warn(`[Allstars] No voice channel ID configured for team: ${teamName} (normalized: ${normalizedName})`);
                    return [];
                }

                const voiceChannel = await guild.channels.fetch(voiceId).catch(() => null);
                if (!voiceChannel || !voiceChannel.isVoiceBased()) {
                    console.warn(`[Allstars] Voice channel ${voiceId} not found or not a voice channel`);
                    return [];
                }

                const usernames = [];
                for (const [memberId, member] of voiceChannel.members) {
                    try {
                        const player = await Player.load(member);
                        if (player && player.ingameUsername) {
                            usernames.push(player.ingameUsername);
                        }
                    } catch (err) {
                        console.error(`[Allstars] Error processing member ${memberId}:`, err);
                    }
                }
                return usernames;
            };

            console.log(`[Allstars] Processing check request: ${data.requestId} for teams ${data.team1Name} and ${data.team2Name}. Match: ${data.matchId || 'N/A'}, Map: ${data.map || 'N/A'}`);

            data.team1 = await processTeam(data.team1Name);
            data.team2 = await processTeam(data.team2Name);
            data.action = 'CONFIRMED';
            data.timestamp = Date.now();

            await redis.publish(CONFIRMED_CHANNEL, JSON.stringify(data));
            console.log(`[Allstars] Confirmed tournament check for ${data.requestId}. Found ${data.team1.length} and ${data.team2.length} players.`);

        } catch (err) {
            console.error('[Allstars] Error processing check message:', err);
        }
    });
}

module.exports = { setupAllstarsListener };
