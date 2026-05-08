const displayNameCache = new Map();

async function refresh(client, membersArg = null) {
  if (!client) return;

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID); // ✅ Fetch the actual guild
    if (!guild) return;

    let members = membersArg;
    if (!members) {
      console.log('[DisplayName Cache] Fetching all members...');
      members = await guild.members.fetch({ withPresences: false });
    }

    members.forEach((member) => {
      const clean = member.displayName.replace(/^\[\d+\]\s*/, '');
      displayNameCache.set(member.id, clean);
    });

    console.log(`[DisplayName Cache] Cached ${displayNameCache.size} display names`);
  } catch (err) {
    console.error('[DisplayName Cache] Failed to fetch all member names:', err);
  }
}

function get(userId) {
  return displayNameCache.get(userId);
}

module.exports = {
  refresh,
  get,
};
