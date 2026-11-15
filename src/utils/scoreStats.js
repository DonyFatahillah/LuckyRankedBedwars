const DISPLAY_STATS = ['kills', 'deaths', 'diamonds', 'emeralds'];

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Match totals only. Missing values must not look like recorded zeroes.
function getMatchDisplayStats(players, ign, queueType, expectedTeam) {
  const matches = Array.isArray(players) ? players.filter(p =>
    typeof p?.ign === 'string' && p.ign.toLowerCase() === String(ign).toLowerCase()
  ) : [];
  const report = matches.length === 1 && (!matches[0].team || matches[0].team === expectedTeam) ? matches[0] : null;
  const prefix = String(queueType || '').startsWith('2v2') ? 'doubles_' : '';
  return Object.fromEntries(DISPLAY_STATS.map(field => [field, validCount(report?.[`${prefix}${field}`])]));
}

function formatScoreStats(stats) {
  const counts = Object.fromEntries(DISPLAY_STATS.map(field => [field, validCount(stats[field])]));
  const kd = counts.kills === null || counts.deaths === null ? 'N/A'
    : (counts.deaths === 0 ? counts.kills : counts.kills / counts.deaths).toFixed(2);
  return {
    ...Object.fromEntries(DISPLAY_STATS.map(field => [field, counts[field] === null ? 'N/A' : String(counts[field])])),
    kd
  };
}

module.exports = { getMatchDisplayStats, formatScoreStats };
