require('dotenv').config();

const RANKS = [
    { name: 'Celestial', elo: 2000, roleId: process.env.CELESTIAL_ROLE_ID },
    { name: 'Elite',     elo: 1900, roleId: process.env.ELITE_ROLE_ID     },
    { name: 'Azurite',   elo: 1800, roleId: process.env.AZURITE_ROLE_ID   },
    { name: 'Amber',     elo: 1700, roleId: process.env.AMBER_ROLE_ID     },
    { name: 'Prism',     elo: 1600, roleId: process.env.PRISM_ROLE_ID     },
    { name: 'Adamite',   elo: 1500, roleId: process.env.ADAMITE_ROLE_ID   },
    { name: 'Agate',     elo: 1400, roleId: process.env.AGATE_ROLE_ID     },
    { name: 'Onyx',      elo: 1300, roleId: process.env.ONYX_ROLE_ID      },
    { name: 'Obsidian',  elo: 1200, roleId: process.env.OBSIDIAN_ROLE_ID  },
    { name: 'Jade',      elo: 1100, roleId: process.env.JADE_ROLE_ID      },
    { name: 'Amethyst',  elo: 1000, roleId: process.env.AMETHYST_ROLE_ID  },
    { name: 'Sapphire',  elo: 900,  roleId: process.env.SAPPHIRE_ROLE_ID  },
    { name: 'Quartz',    elo: 800,  roleId: process.env.QUARTZ_ROLE_ID    },
    { name: 'Crystal',   elo: 700,  roleId: process.env.CRYSTAL_ROLE_ID   },
    { name: 'Emerald',   elo: 600,  roleId: process.env.EMERALD_ROLE_ID   },
    { name: 'Diamond',   elo: 500,  roleId: process.env.DIAMOND_ROLE_ID   },
    { name: 'Platinum',  elo: 400,  roleId: process.env.PLATINUM_ROLE_ID  },
    { name: 'Gold',      elo: 300,  roleId: process.env.GOLD_ROLE_ID      },
    { name: 'Silver',    elo: 200,  roleId: process.env.SILVER_ROLE_ID    },
    { name: 'Bronze',    elo: 100,  roleId: process.env.BRONZE_ROLE_ID    },
    { name: 'Iron',      elo: 0,    roleId: process.env.IRON_ROLE_ID      },
];

function getRankByElo(elo) {
  // Make sure it's sorted from highest to lowest
  const sorted = [...RANKS].sort((a, b) => b.elo - a.elo);
  return sorted.find(rank => elo >= rank.elo);
}

async function updateRankRoles(member, elo) {
  const correctRank = getRankByElo(elo);
  if (!correctRank || !correctRank.roleId) return;

  const hasCorrectRole = member.roles.cache.has(correctRank.roleId);

  if (hasCorrectRole) return; // ✅ Already correct role assigned

  // Remove all other rank roles
  const otherRankRoleIds = RANKS
    .map(r => r.roleId)
    .filter(id => id && id !== correctRank.roleId && member.roles.cache.has(id));

  if (otherRankRoleIds.length > 0) {
    await member.roles.remove(otherRankRoleIds).catch(console.error);
  }

  // Assign correct role
  await member.roles.add(correctRank.roleId).catch(console.error);
}

module.exports = {
  getRankByElo,
  updateRankRoles,
};
