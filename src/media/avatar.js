async function fetchAvatarAsBase64(url, referer) {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { Referer: referer || new URL(url).origin, 'User-Agent': 'Mozilla/5.0 (compatible; OAuthCenter/1.0)' },
    });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get('content-type') || 'image/jpeg';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch (error) {
    console.error('[avatar] download failed:', error.message);
    return null;
  }
}

module.exports = { fetchAvatarAsBase64 };
