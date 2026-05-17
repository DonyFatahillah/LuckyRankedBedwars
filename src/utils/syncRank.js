const { getElo } = require('./eloManager');
const { getRankByElo, updateRankRoles } = require('./EloRank');

async function syncRank(member) {
  const elo = await getElo(member.id);
  if (elo === undefined || elo === null) return; // No ELO stored
  await updateRankRoles(member, elo);
}

module.exports = {
  getRankByElo,
  updateRankRoles,
  syncRank
};
