const { getElo } = require('./eloManager');

async function syncRank(member) {
  const elo = getElo(member.id);
  if (elo === undefined || elo === null) return; // No ELO stored
  await updateRankRoles(member, elo);
}

module.exports = {
  getRankByElo,
  updateRankRoles,
  syncRank
};
