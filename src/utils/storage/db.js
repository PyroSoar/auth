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
  if (!pool) return true;
  try {
    // Attempt to insert the code. If it already exists, this throws an error.
    await pool.query(
      'INSERT INTO oauth_locks (code) VALUES ($1)',
      [code]
    );
    return true; // Successfully claimed
  } catch (err) {
    // Error code 23505 is PostgreSQL's Unique Violation
    if (err.code === '23505') return false; 
    throw err;
  }
}
async function saveOAuthResult(code, result) {
  if (!pool) return;
  await pool.query(
    'UPDATE oauth_locks SET result = $2 WHERE code = $1',
    [code, JSON.stringify(result)]
  );
}
async function getOAuthResult(code) {
  if (!pool) return null;
  const { rows } = await pool.query(
    'SELECT result FROM oauth_locks WHERE code = $1',
    [code]
  );
  return rows[0]?.result || null;
}

module.exports = {
  upsertThirdPartyInfo,
  claimOAuthCode, saveOAuthResult, getOAuthResult
};