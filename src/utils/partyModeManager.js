const PartySettingsModel = require('../models/PartySettingsSchema');

async function isPartyMatch() {
  const doc = await PartySettingsModel.findOne({ settingKey: 'partyMatchEnabled' });
  return doc ? doc.value : false;
}

async function setPartyMatch(state) {
  await PartySettingsModel.findOneAndUpdate(
    { settingKey: 'partyMatchEnabled' },
    { settingKey: 'partyMatchEnabled', value: Boolean(state) },
    { upsert: true }
  );
}

module.exports = {
  isPartyMatch,
  setPartyMatch
};
