const { createUserResponse } = require('../utils');
const storage = require('../utils/storage/db');

function persistProfile(platform, profile) {
  if (!process.env.POSTGRES_URL) return;
  try {
    const { waitUntil } = require('@vercel/functions');
    waitUntil(storage.upsertThirdPartyInfo(platform, profile)
      .catch(error => console.error('[profile] persistence failed:', error.message)));
  } catch (error) {
    console.warn('[profile] background persistence unavailable:', error.message);
  }
}

async function normalizeProfile(profile, platform) {
  persistProfile(platform, profile);
  const response = createUserResponse(profile, platform);
  return response.get ? response.get() : response;
}

module.exports = { normalizeProfile };
