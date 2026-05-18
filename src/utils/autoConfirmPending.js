const { getActiveGames } = require('../queue/queueManager');
const { getLogs } = require('./matchLogger');
const autoConfirmMatch = require('./autoConfirmMatch');
const Player = require('../models/Player');

module.exports = async function autoConfirmPendingMatches(client) {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const activeGamesArray = await getActiveGames();
  const activeGames = new Map(activeGamesArray.map(g => [g.gameId, g]));
  const logs = getLogs();

  const confirmTasks = Object.entries(logs).map(async ([gameId, log]) => {
    if (!log.submitted || log.status !== 'pending' || !activeGames.has(gameId)) return;

    const match = activeGames.get(gameId);
    // Standardize team data access
    const teams = [match.teamA || match.teams?.[0], match.teamB || match.teams?.[1]];
    if (!teams[0] || !teams[1]) return;

    const allPlayerIds = [...teams[0], ...teams[1]];

    const members = await Promise.all(
      allPlayerIds.map(async id => {
        try {
          return await guild.members.fetch(id);
        } catch {
          return null;
        }
      })
    );

    const memberMap = new Map(); // Map of memberId → { member, player }
    await Promise.all(members.filter(Boolean).map(async member => {
      const player = await Player.load(member);
      memberMap.set(member.id, { member, player });
    }));

    // Helper function: get player by mention or username
    const findPlayerByIdentifier = (identifier) => {
      if (!identifier) return null;
      const mentionMatch = identifier.match(/^<@!?(\d+)>$/);
      if (mentionMatch) {
        const userId = mentionMatch[1];
        return memberMap.get(userId) || null;
      }
      return [...memberMap.values()].find(({ player }) =>
        player.username.toLowerCase() === identifier.toLowerCase()
      ) || null;
    };

    // Resolve winBedbreaker
    const winMemberEntry = findPlayerByIdentifier(log.winBedbreaker);
    if (!winMemberEntry) {
      console.warn(`[AutoConfirm] WinBedbreaker ${log.winBedbreaker} not found in guild for ${gameId}`);
      return;
    }

    const winMember = winMemberEntry.member;
    let winner;
    if (teams[0].includes(winMember.id)) winner = 'team1';
    else if (teams[1].includes(winMember.id)) winner = 'team2';
    else {
      console.warn(`[AutoConfirm] WinBedbreaker ${log.winBedbreaker} not in any team for ${gameId}`);
      return;
    }

    // Resolve topKiller
    let topKillerName = log.topKiller || log.winBedbreaker;
    const topEntry = findPlayerByIdentifier(topKillerName);
    if (topEntry) topKillerName = topEntry.member.displayName;

    // Resolve loseBedbreaker
    let loseBedDisplay = null;
    if (log.loseBedbreaker) {
      const loseEntry = findPlayerByIdentifier(log.loseBedbreaker);
      if (loseEntry) loseBedDisplay = loseEntry.member.displayName;
    }

    // Auto-confirm the match
    await autoConfirmMatch(client, guild, gameId, {
      winner,
      winBedbreaker: winMember.displayName,
      loseBedbreaker: loseBedDisplay,
      topKiller: topKillerName
    });

    return true;
  });

  const results = await Promise.all(confirmTasks);
  const confirmedCount = results.filter(Boolean).length;

  console.log(`[AutoConfirm] ✅ Auto-confirmed ${confirmedCount} pending matches`);
};
