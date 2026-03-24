// storage/db.js
const { createPool } = require('@vercel/postgres');

// 1. Manually strip the sslmode to avoid the handshake conflict
const rawUrl = process.env.POSTGRES_URL || '';
let pool = null;
if (rawUrl) {
  const cleanUrl = rawUrl.replace(/([\?&])sslmode=[^&]+(&|$)/, '$1').replace(/\?$/, '');
  pool = createPool({
    connectionString: cleanUrl,
  });
}

// In-memory store for tracking used OAuth codes and their results
const inMemoryStore = {
  usedCodes: new Set(),
  codeResults: new Map(),
};

async function upsertThirdPartyInfo(platform, user) {
  if (!pool) return true;
  try {
    console.log('[storage/db] upsert start:', platform, user.id);

    // Use pool.query for the most stable background execution
    await pool.query(
      `INSERT INTO wl_3rd_info 
       (platform, id, name, email, avatar, url, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (platform, id) 
       DO UPDATE SET 
         name = EXCLUDED.name, 
         email = EXCLUDED.email, 
         avatar = EXCLUDED.avatar, 
         url = EXCLUDED.url, 
         updated_at = CURRENT_TIMESTAMP`,
      [platform, user.id, user.name || null, user.email || null, user.avatar || null, user.url || null]
    );

    console.log('[storage/db] upsert success');
    return true;
  } catch (err) {
    console.error('[storage/db] DB Query Error:', err.message);
    return false;
  }
}

async function claimOAuthCode(code) {
  // Use in-memory store for all environments
  if (inMemoryStore.usedCodes.has(code)) {
    return false;
  }
  inMemoryStore.usedCodes.add(code);
  return true;
}
async function saveOAuthResult(code, result) {
  // Use in-memory store for all environments
  inMemoryStore.codeResults.set(code, JSON.stringify(result));
}
async function getOAuthResult(code) {
  // Use in-memory store for all environments
  return inMemoryStore.codeResults.get(code) || null;
}

module.exports = {
  upsertThirdPartyInfo,
  claimOAuthCode, saveOAuthResult, getOAuthResult
};