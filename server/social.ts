import crypto from 'node:crypto';
import net from 'node:net';
import { db, decryptSecret, encryptSecret } from './db.ts';
import { COUNTRY_LOCATION_HINTS, detectCountryFromText, getCountryName } from '../src/shared/countries.ts';

interface OAuthStateEntry {
  provider: 'meta' | 'twitter';
  codeVerifier?: string;
  createdAt: number;
}

const oauthStates = new Map<string, OAuthStateEntry>();

// Prune stale OAuth states older than 15 minutes
function pruneOAuthStates(): void {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, entry] of oauthStates.entries()) {
    if (entry.createdAt < cutoff) {
      oauthStates.delete(key);
    }
  }
}

export function getAppUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (raw && raw !== 'MY_APP_URL') {
    return raw.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

export function isSafePublicUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '169.254.169.254' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    const ipType = net.isIP(host);
    if (ipType === 4) {
      const octets = host.split('.').map(Number);
      if (
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 169 && octets[1] === 254)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function extractPostId(platform: string, rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    const segments = u.pathname.split('/').filter(Boolean);
    if (platform === 'twitter') {
      const statusIdx = segments.indexOf('status');
      if (statusIdx !== -1 && segments[statusIdx + 1]) {
        return segments[statusIdx + 1];
      }
    }
    if (platform === 'instagram') {
      const reelIdx = segments.findIndex((s) => s === 'reel' || s === 'reels' || s === 'p');
      if (reelIdx !== -1 && segments[reelIdx + 1]) {
        return segments[reelIdx + 1];
      }
    }
    if (platform === 'facebook') {
      const reelIdx = segments.indexOf('reel');
      if (reelIdx !== -1 && segments[reelIdx + 1]) {
        return segments[reelIdx + 1];
      }
      const postsIdx = segments.indexOf('posts');
      if (postsIdx !== -1 && segments[postsIdx + 1]) {
        return segments[postsIdx + 1];
      }
      const fbid = u.searchParams.get('fbid') || u.searchParams.get('story_fbid');
      if (fbid) return fbid;
    }
    return segments[segments.length - 1] || trimmed;
  } catch {
    return trimmed;
  }
}

export function getOAuthConfigStatus() {
  const appUrl = getAppUrl();
  const metaConfigured = Boolean(process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim());
  const twitterConfigured = Boolean(process.env.TWITTER_CLIENT_ID?.trim());

  return {
    appUrl,
    meta: {
      configured: metaConfigured,
      callbackUrl: `${appUrl}/auth/meta/callback`,
      scopes: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_engagement',
        'instagram_basic',
        'instagram_manage_comments',
        'public_profile',
      ],
    },
    twitter: {
      configured: twitterConfigured,
      callbackUrl: `${appUrl}/auth/twitter/callback`,
      scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    },
  };
}

export function buildMetaAuthUrl(): string {
  const clientId = process.env.META_APP_ID?.trim();
  const clientSecret = process.env.META_APP_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('META_APP_ID and META_APP_SECRET must be configured in AI Studio Secrets.');
  }
  pruneOAuthStates();
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { provider: 'meta', createdAt: Date.now() });

  const redirectUri = `${getAppUrl()}/auth/meta/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: 'pages_show_list,pages_read_engagement,pages_manage_engagement,instagram_basic,instagram_manage_comments,public_profile',
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export function buildTwitterAuthUrl(): string {
  const clientId = process.env.TWITTER_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('TWITTER_CLIENT_ID must be configured in AI Studio Secrets.');
  }
  pruneOAuthStates();
  const state = crypto.randomBytes(24).toString('hex');
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  oauthStates.set(state, { provider: 'twitter', codeVerifier, createdAt: Date.now() });

  const redirectUri = `${getAppUrl()}/auth/twitter/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

function upsertSocialAccount(params: {
  provider: 'meta' | 'twitter';
  platform: 'facebook' | 'instagram' | 'twitter';
  externalId: string;
  accountName: string;
  username: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number | null;
  scopes?: string;
  connectionMode: 'oauth' | 'token';
}): string {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM social_accounts WHERE platform = ? AND external_id = ?')
    .get(params.platform, params.externalId) as { id: string } | undefined;

  const id = existing?.id || crypto.randomUUID();
  const accessEnc = encryptSecret(params.accessToken);
  const refreshEnc = params.refreshToken ? encryptSecret(params.refreshToken) : null;

  if (existing) {
    db.prepare(`
      UPDATE social_accounts
      SET account_name = ?, username = ?, avatar_url = ?, access_token_enc = ?,
          refresh_token_enc = COALESCE(?, refresh_token_enc), token_expires_at = ?,
          scopes = ?, connection_mode = ?, status = 'connected', connected_at = ?
      WHERE id = ?
    `).run(
      params.accountName,
      params.username,
      params.avatarUrl || '',
      accessEnc,
      refreshEnc,
      params.tokenExpiresAt || null,
      params.scopes || '',
      params.connectionMode,
      now,
      id
    );
  } else {
    db.prepare(`
      INSERT INTO social_accounts (
        id, provider, platform, external_id, account_name, username, avatar_url,
        access_token_enc, refresh_token_enc, token_expires_at, scopes, connection_mode, status, connected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?)
    `).run(
      id,
      params.provider,
      params.platform,
      params.externalId,
      params.accountName,
      params.username,
      params.avatarUrl || '',
      accessEnc,
      refreshEnc,
      params.tokenExpiresAt || null,
      params.scopes || '',
      params.connectionMode,
      now
    );
  }
  return id;
}

async function syncMetaPagesAndInstagram(userAccessToken: string, connectionMode: 'oauth' | 'token'): Promise<number> {
  let count = 0;

  // Fetch user's managed Facebook Pages and linked Instagram Business Accounts
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(userAccessToken)}`
  );
  const pagesJson = (await pagesRes.json()) as {
    data?: Array<{
      id: string;
      name: string;
      access_token?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: {
        id: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
      };
    }>;
    error?: { message?: string };
  };

  if (pagesJson.error) {
    // Token might be a Page Token directly instead of a User Token — check /me directly
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name,username,picture{url},instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(userAccessToken)}`
    );
    const meJson = (await meRes.json()) as {
      id?: string;
      name?: string;
      username?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: {
        id: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
      };
      error?: { message?: string };
    };
    if (meJson.error || !meJson.id) {
      throw new Error(meJson.error?.message || pagesJson.error.message || 'Meta Graph API verification failed.');
    }

    upsertSocialAccount({
      provider: 'meta',
      platform: 'facebook',
      externalId: meJson.id,
      accountName: meJson.name || 'Facebook Account',
      username: meJson.username || meJson.id,
      avatarUrl: meJson.picture?.data?.url || '',
      accessToken: userAccessToken,
      scopes: 'pages_manage_engagement,instagram_manage_comments',
      connectionMode,
    });
    count += 1;

    if (meJson.instagram_business_account?.id) {
      const ig = meJson.instagram_business_account;
      upsertSocialAccount({
        provider: 'meta',
        platform: 'instagram',
        externalId: ig.id,
        accountName: ig.name || ig.username || 'Instagram Business',
        username: ig.username || ig.id,
        avatarUrl: ig.profile_picture_url || '',
        accessToken: userAccessToken,
        scopes: 'instagram_basic,instagram_manage_comments',
        connectionMode,
      });
      count += 1;
    }
    return count;
  }

  const pages = pagesJson.data || [];
  if (pages.length === 0) {
    // Still save personal Meta profile if no Pages exist so user sees connection feedback
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name,picture{url}&access_token=${encodeURIComponent(userAccessToken)}`
    );
    const meJson = (await meRes.json()) as { id?: string; name?: string; picture?: { data?: { url?: string } } };
    if (meJson.id) {
      upsertSocialAccount({
        provider: 'meta',
        platform: 'facebook',
        externalId: meJson.id,
        accountName: meJson.name || 'Facebook Profile',
        username: meJson.id,
        avatarUrl: meJson.picture?.data?.url || '',
        accessToken: userAccessToken,
        scopes: 'public_profile',
        connectionMode,
      });
      count += 1;
    }
    return count;
  }

  for (const page of pages) {
    const pageToken = page.access_token || userAccessToken;
    upsertSocialAccount({
      provider: 'meta',
      platform: 'facebook',
      externalId: page.id,
      accountName: page.name,
      username: page.id,
      avatarUrl: page.picture?.data?.url || '',
      accessToken: pageToken,
      scopes: 'pages_show_list,pages_read_engagement,pages_manage_engagement',
      connectionMode,
    });
    count += 1;

    if (page.instagram_business_account?.id) {
      const ig = page.instagram_business_account;
      upsertSocialAccount({
        provider: 'meta',
        platform: 'instagram',
        externalId: ig.id,
        accountName: ig.name || ig.username || `${page.name} IG`,
        username: ig.username || ig.id,
        avatarUrl: ig.profile_picture_url || '',
        accessToken: pageToken,
        scopes: 'instagram_basic,instagram_manage_comments',
        connectionMode,
      });
      count += 1;
    }
  }
  return count;
}

export async function exchangeMetaCodeAndSaveAccounts(code: string, state: string): Promise<number> {
  const entry = oauthStates.get(state);
  if (!entry || entry.provider !== 'meta') {
    throw new Error('Invalid or expired Meta OAuth state.');
  }
  oauthStates.delete(state);

  const clientId = process.env.META_APP_ID?.trim() || '';
  const clientSecret = process.env.META_APP_SECRET?.trim() || '';
  const redirectUri = `${getAppUrl()}/auth/meta/callback`;

  const tokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${tokenParams.toString()}`);
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: { message?: string } };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error?.message || 'Failed to exchange Meta OAuth code.');
  }

  // Exchange for long-lived token (60 days)
  let finalToken = tokenJson.access_token;
  try {
    const longParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: tokenJson.access_token,
    });
    const longRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${longParams.toString()}`);
    const longJson = (await longRes.json()) as { access_token?: string };
    if (longJson.access_token) {
      finalToken = longJson.access_token;
    }
  } catch {
    // Keep short-lived token if long-lived exchange fails
  }

  return syncMetaPagesAndInstagram(finalToken, 'oauth');
}

export async function exchangeTwitterCodeAndSaveAccount(code: string, state: string): Promise<void> {
  const entry = oauthStates.get(state);
  if (!entry || entry.provider !== 'twitter' || !entry.codeVerifier) {
    throw new Error('Invalid or expired Twitter/X OAuth state.');
  }
  oauthStates.delete(state);

  const clientId = process.env.TWITTER_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.TWITTER_CLIENT_SECRET?.trim() || '';
  const redirectUri = `${getAppUrl()}/auth/twitter/callback`;

  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: entry.codeVerifier,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
    error?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || tokenJson.error || 'Failed to exchange Twitter/X OAuth code.');
  }

  const meRes = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const meJson = (await meRes.json()) as {
    data?: { id: string; name: string; username: string; profile_image_url?: string };
    detail?: string;
  };
  if (!meRes.ok || !meJson.data?.id) {
    throw new Error(meJson.detail || 'Failed to retrieve Twitter/X profile.');
  }

  const expiresAt = tokenJson.expires_in ? Date.now() + tokenJson.expires_in * 1000 : null;
  upsertSocialAccount({
    provider: 'twitter',
    platform: 'twitter',
    externalId: meJson.data.id,
    accountName: meJson.data.name,
    username: meJson.data.username,
    avatarUrl: meJson.data.profile_image_url || '',
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    tokenExpiresAt: expiresAt,
    scopes: tokenJson.scope || 'tweet.read tweet.write users.read offline.access',
    connectionMode: 'oauth',
  });
}

export async function verifyAndSaveDirectToken(provider: 'meta' | 'twitter', accessToken: string): Promise<{ count: number }> {
  const token = accessToken.trim();
  if (!token) {
    throw new Error('Access token is required.');
  }

  if (provider === 'meta') {
    const count = await syncMetaPagesAndInstagram(token, 'token');
    return { count };
  }

  const meRes = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meJson = (await meRes.json()) as {
    data?: { id: string; name: string; username: string; profile_image_url?: string };
    detail?: string;
    title?: string;
  };
  if (!meRes.ok || !meJson.data?.id) {
    throw new Error(meJson.detail || meJson.title || 'Twitter/X token verification failed.');
  }

  upsertSocialAccount({
    provider: 'twitter',
    platform: 'twitter',
    externalId: meJson.data.id,
    accountName: meJson.data.name,
    username: meJson.data.username,
    avatarUrl: meJson.data.profile_image_url || '',
    accessToken: token,
    scopes: 'tweet.read tweet.write users.read',
    connectionMode: 'token',
  });
  return { count: 1 };
}

async function getValidAccessToken(accountId: string): Promise<{
  platform: 'facebook' | 'instagram' | 'twitter';
  externalId: string;
  accessToken: string;
}> {
  const row = db
    .prepare('SELECT id, platform, external_id, access_token_enc, refresh_token_enc, token_expires_at FROM social_accounts WHERE id = ?')
    .get(accountId) as
    | {
        id: string;
        platform: 'facebook' | 'instagram' | 'twitter';
        external_id: string;
        access_token_enc: string;
        refresh_token_enc: string | null;
        token_expires_at: number | null;
      }
    | undefined;

  if (!row) {
    throw new Error('Connected social account not found.');
  }
  let token = decryptSecret(row.access_token_enc);
  if (!token) {
    throw new Error('Stored token could not be decrypted. Reconnect the account.');
  }

  // Refresh Twitter OAuth2 token if expiring within 2 minutes
  if (
    row.platform === 'twitter' &&
    row.token_expires_at &&
    row.token_expires_at < Date.now() + 120_000 &&
    row.refresh_token_enc
  ) {
    const refreshToken = decryptSecret(row.refresh_token_enc);
    const clientId = process.env.TWITTER_CLIENT_ID?.trim();
    const clientSecret = process.env.TWITTER_CLIENT_SECRET?.trim();
    if (refreshToken && clientId) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (clientSecret) {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      }
      const refreshRes = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers,
        body: body.toString(),
      });
      const refreshJson = (await refreshRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (refreshRes.ok && refreshJson.access_token) {
        token = refreshJson.access_token;
        const newExpires = refreshJson.expires_in ? Date.now() + refreshJson.expires_in * 1000 : null;
        db.prepare(
          'UPDATE social_accounts SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), token_expires_at = ?, status = ? WHERE id = ?'
        ).run(
          encryptSecret(token),
          refreshJson.refresh_token ? encryptSecret(refreshJson.refresh_token) : null,
          newExpires,
          'connected',
          row.id
        );
      }
    }
  }

  return {
    platform: row.platform,
    externalId: row.external_id,
    accessToken: token,
  };
}

export async function publishSocialComment(params: {
  accountId: string;
  targetPostInput: string;
  message: string;
}): Promise<{ ok: boolean; externalCommentId?: string; error?: string }> {
  try {
    const { platform, accessToken } = await getValidAccessToken(params.accountId);
    const targetId = extractPostId(platform, params.targetPostInput);
    if (!targetId) {
      return { ok: false, error: 'Target Post/Reel ID is empty.' };
    }

    if (platform === 'facebook' || platform === 'instagram') {
      const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(targetId)}/comments`;
      const body = new URLSearchParams({
        message: params.message,
        access_token: accessToken,
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const json = (await res.json()) as { id?: string; error?: { message?: string; code?: number } };
      if (!res.ok || !json.id) {
        if (json.error?.code === 190) {
          db.prepare('UPDATE social_accounts SET status = ? WHERE id = ?').run('expired', params.accountId);
        }
        return { ok: false, error: json.error?.message || `Meta API error (${res.status})` };
      }
      return { ok: true, externalCommentId: json.id };
    }

    if (platform === 'twitter') {
      const res = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: params.message.slice(0, 280),
          reply: {
            in_reply_to_tweet_id: targetId,
          },
        }),
      });
      const json = (await res.json()) as {
        data?: { id: string };
        detail?: string;
        title?: string;
        errors?: Array<{ message?: string }>;
      };
      if (!res.ok || !json.data?.id) {
        if (res.status === 401) {
          db.prepare('UPDATE social_accounts SET status = ? WHERE id = ?').run('expired', params.accountId);
        }
        const errMsg = json.detail || json.errors?.[0]?.message || json.title || `X API error (${res.status})`;
        return { ok: false, error: errMsg };
      }
      return { ok: true, externalCommentId: json.data.id };
    }

    return { ok: false, error: `Unsupported platform: ${platform}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Comment dispatch error' };
  }
}

export interface DiscoveredPost {
  id: string;
  platform: 'facebook' | 'instagram' | 'twitter';
  title: string;
  permalink: string;
  mediaType: string;
  engagementScore: number;
  likesCount: number;
  commentsCount: number;
  detectedCountry: string | null;
  locationLabel: string;
  locationConfidence: 'verified_geo' | 'profile_location' | 'caption_signal' | 'unverified';
}

function rankAndFilterDiscoveredPosts(
  items: DiscoveredPost[],
  targetCountries: string[],
  minEngagement: number,
  strictGeo: boolean
): DiscoveredPost[] {
  const targetSet = new Set(targetCountries.map((c) => c.toUpperCase()));

  // Filter for real active traffic first; fall back to all items only if minEngagement <= 0
  let pool = items.filter((item) => item.engagementScore >= Math.max(0, minEngagement));
  if (pool.length === 0 && minEngagement > 0) {
    // Only keep posts that have at least 1 real interaction if threshold was too high
    const nonZero = items.filter((item) => item.engagementScore > 0);
    pool = nonZero;
  }

  if (strictGeo && targetSet.size > 0) {
    const geoMatched = pool.filter((item) => item.detectedCountry && targetSet.has(item.detectedCountry));
    pool = geoMatched;
  }

  return pool.sort((a, b) => {
    const aGeoMatch = a.detectedCountry && targetSet.has(a.detectedCountry) ? 1 : 0;
    const bGeoMatch = b.detectedCountry && targetSet.has(b.detectedCountry) ? 1 : 0;
    if (aGeoMatch !== bGeoMatch) return bGeoMatch - aGeoMatch;

    const confRank = { verified_geo: 3, profile_location: 2, caption_signal: 1, unverified: 0 };
    if (confRank[a.locationConfidence] !== confRank[b.locationConfidence]) {
      return confRank[b.locationConfidence] - confRank[a.locationConfidence];
    }
    return b.engagementScore - a.engagementScore;
  });
}

export async function discoverTargetPosts(params: {
  accountId: string;
  keyword?: string;
  targetCountries?: string[];
  minEngagement?: number;
  strictGeo?: boolean;
}): Promise<DiscoveredPost[]> {
  const { platform, externalId, accessToken } = await getValidAccessToken(params.accountId);
  const keyword = (params.keyword || '').trim().replace(/^#/, '');
  const targetCountries = params.targetCountries || [];
  const minEngagement = typeof params.minEngagement === 'number' ? params.minEngagement : 1;
  const strictGeo = Boolean(params.strictGeo);

  if (platform === 'facebook') {
    const reelsRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(externalId)}/video_reels?fields=id,description,permalink_url,created_time,place{name,location{country,city}},likes.summary(true).limit(0),comments.summary(true).limit(0)&limit=20&access_token=${encodeURIComponent(accessToken)}`
    );
    const reelsJson = (await reelsRes.json()) as {
      data?: Array<{
        id: string;
        description?: string;
        permalink_url?: string;
        place?: { name?: string; location?: { country?: string; city?: string } };
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
      }>;
      error?: { message?: string };
    };
    if (!reelsJson.error && reelsJson.data?.length) {
      const mapped: DiscoveredPost[] = reelsJson.data.map((reel) => {
        const likesCount = reel.likes?.summary?.total_count || 0;
        const commentsCount = reel.comments?.summary?.total_count || 0;
        const placeCountry = reel.place?.location?.country;
        const placeCity = reel.place?.location?.city;
        const detectedFromPlace = detectCountryFromText(placeCountry);
        const detectedFromCaption = detectCountryFromText(reel.description);
        const detectedCountry = detectedFromPlace || detectedFromCaption;
        const locationConfidence: DiscoveredPost['locationConfidence'] = detectedFromPlace
          ? 'verified_geo'
          : detectedFromCaption
            ? 'caption_signal'
            : 'unverified';
        const locationLabel = detectedFromPlace
          ? `${placeCity ? `${placeCity}, ` : ''}${placeCountry} (Verified Geo)`
          : detectedFromCaption
            ? `${getCountryName(detectedFromCaption)} (Caption Signal)`
            : 'Location not tagged';

        return {
          id: reel.id,
          platform: 'facebook',
          title: (reel.description || 'Facebook Reel Video').slice(0, 110),
          permalink: reel.permalink_url || `https://facebook.com/reel/${reel.id}`,
          mediaType: 'FB REEL',
          engagementScore: likesCount + commentsCount * 3,
          likesCount,
          commentsCount,
          detectedCountry,
          locationLabel,
          locationConfidence,
        };
      });
      return rankAndFilterDiscoveredPosts(mapped, targetCountries, minEngagement, strictGeo);
    }

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(externalId)}/published_posts?fields=id,message,permalink_url,created_time,place{name,location{country,city}},likes.summary(true).limit(0),comments.summary(true).limit(0)&limit=15&access_token=${encodeURIComponent(accessToken)}`
    );
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        message?: string;
        permalink_url?: string;
        place?: { name?: string; location?: { country?: string; city?: string } };
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
      }>;
      error?: { message?: string };
    };
    if (json.error) {
      throw new Error(json.error.message || 'Facebook Reels/post lookup failed.');
    }
    const mapped: DiscoveredPost[] = (json.data || []).map((post) => {
      const likesCount = post.likes?.summary?.total_count || 0;
      const commentsCount = post.comments?.summary?.total_count || 0;
      const placeCountry = post.place?.location?.country;
      const placeCity = post.place?.location?.city;
      const detectedFromPlace = detectCountryFromText(placeCountry);
      const detectedFromCaption = detectCountryFromText(post.message);
      const detectedCountry = detectedFromPlace || detectedFromCaption;
      const locationConfidence: DiscoveredPost['locationConfidence'] = detectedFromPlace
        ? 'verified_geo'
        : detectedFromCaption
          ? 'caption_signal'
          : 'unverified';
      const locationLabel = detectedFromPlace
        ? `${placeCity ? `${placeCity}, ` : ''}${placeCountry} (Verified Geo)`
        : detectedFromCaption
          ? `${getCountryName(detectedFromCaption)} (Caption Signal)`
          : 'Location not tagged';

      return {
        id: post.id,
        platform: 'facebook',
        title: (post.message || 'Facebook Reel / Video Post').slice(0, 110),
        permalink: post.permalink_url || `https://facebook.com/${post.id}`,
        mediaType: 'FB VIDEO',
        engagementScore: likesCount + commentsCount * 3,
        likesCount,
        commentsCount,
        detectedCountry,
        locationLabel,
        locationConfidence,
      };
    });
    return rankAndFilterDiscoveredPosts(mapped, targetCountries, minEngagement, strictGeo);
  }

  if (platform === 'instagram') {
    type IgMediaItem = {
      id: string;
      caption?: string;
      media_type?: string;
      media_product_type?: string;
      permalink?: string;
      like_count?: number;
      comments_count?: number;
    };

    const mapIgItems = (items: IgMediaItem[]): DiscoveredPost[] => {
      const reelsOnly = items.filter(
        (m) => m.media_product_type === 'REELS' || m.media_type === 'VIDEO'
      );
      const list = reelsOnly.length > 0 ? reelsOnly : items;
      return list.map((m) => {
        const likesCount = m.like_count || 0;
        const commentsCount = m.comments_count || 0;
        const detectedCountry = detectCountryFromText(m.caption);
        return {
          id: m.id,
          platform: 'instagram',
          title: (m.caption || 'Instagram Reel Video').slice(0, 110),
          permalink: m.permalink || 'https://instagram.com',
          mediaType: m.media_product_type || m.media_type || 'REELS',
          engagementScore: likesCount + commentsCount * 3,
          likesCount,
          commentsCount,
          detectedCountry,
          locationLabel: detectedCountry
            ? `${getCountryName(detectedCountry)} (Caption/Hashtag Signal)`
            : 'Location not tagged',
          locationConfidence: detectedCountry ? 'caption_signal' : 'unverified',
        };
      });
    };

    const primaryGeoHint =
      targetCountries.length > 0
        ? (COUNTRY_LOCATION_HINTS[targetCountries[0]]?.searchTerms[0] || '').toLowerCase().replace(/\s+/g, '')
        : '';
    const hashtagCandidates = [
      keyword && primaryGeoHint ? `${primaryGeoHint}${keyword}` : '',
      keyword || '',
      primaryGeoHint ? `${primaryGeoHint}reels` : '',
    ].filter(Boolean);

    for (const tag of hashtagCandidates) {
      const searchRes = await fetch(
        `https://graph.facebook.com/v21.0/ig_hashtag_search?user_id=${encodeURIComponent(externalId)}&q=${encodeURIComponent(tag)}&access_token=${encodeURIComponent(accessToken)}`
      );
      const searchJson = (await searchRes.json()) as { data?: Array<{ id: string }>; error?: { message?: string } };
      const hashtagId = searchJson.data?.[0]?.id;
      if (hashtagId) {
        // Prioritize top_media first to capture high-engagement active Reels with real traffic
        const topRes = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(hashtagId)}/top_media?user_id=${encodeURIComponent(externalId)}&fields=id,caption,media_type,media_product_type,permalink,like_count,comments_count&limit=25&access_token=${encodeURIComponent(accessToken)}`
        );
        const topJson = (await topRes.json()) as { data?: IgMediaItem[] };

        const recentRes = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(hashtagId)}/recent_media?user_id=${encodeURIComponent(externalId)}&fields=id,caption,media_type,media_product_type,permalink,like_count,comments_count&limit=25&access_token=${encodeURIComponent(accessToken)}`
        );
        const recentJson = (await recentRes.json()) as { data?: IgMediaItem[] };

        const combined = [...(topJson.data || []), ...(recentJson.data || [])];
        const unique = Array.from(new Map(combined.map((item) => [item.id, item])).values());
        if (unique.length > 0) {
          const ranked = rankAndFilterDiscoveredPosts(mapIgItems(unique), targetCountries, minEngagement, strictGeo);
          if (ranked.length > 0) return ranked;
        }
      }
    }

    const ownRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(externalId)}/media?fields=id,caption,media_type,media_product_type,permalink,like_count,comments_count&limit=25&access_token=${encodeURIComponent(accessToken)}`
    );
    const ownJson = (await ownRes.json()) as {
      data?: IgMediaItem[];
      error?: { message?: string };
    };
    if (ownJson.error) {
      throw new Error(ownJson.error.message || 'Instagram Reels lookup failed.');
    }
    return rankAndFilterDiscoveredPosts(mapIgItems(ownJson.data || []), targetCountries, minEngagement, strictGeo);
  }

  if (platform === 'twitter') {
    const geoTerms = targetCountries
      .slice(0, 3)
      .flatMap((code) => COUNTRY_LOCATION_HINTS[code]?.searchTerms.slice(0, 1) || []);
    const baseTopic = keyword || 'reels OR video';
    const queryStr =
      geoTerms.length > 0
        ? `(${baseTopic}) (${geoTerms.map((t) => `"${t}"`).join(' OR ')}) has:videos -is:retweet`
        : `${baseTopic} has:videos -is:retweet`;

    const buildTwitterSearchUrl = (q: string) =>
      `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=25&tweet.fields=created_at,author_id,public_metrics,geo,lang&expansions=author_id,geo.place_id&user.fields=location,public_metrics&place.fields=country_code,country,full_name`;

    const parseTwitterSearch = (json: {
      data?: Array<{
        id: string;
        text: string;
        author_id?: string;
        geo?: { place_id?: string };
        public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; impression_count?: number };
      }>;
      includes?: {
        users?: Array<{ id: string; location?: string }>;
        places?: Array<{ id: string; country_code?: string; country?: string; full_name?: string }>;
      };
    }): DiscoveredPost[] => {
      const userMap = new Map((json.includes?.users || []).map((u) => [u.id, u]));
      const placeMap = new Map((json.includes?.places || []).map((p) => [p.id, p]));

      return (json.data || []).map((t) => {
        const metrics = t.public_metrics || {};
        const likesCount = metrics.like_count || 0;
        const commentsCount = metrics.reply_count || 0;
        const retweets = metrics.retweet_count || 0;
        const impressions = metrics.impression_count || 0;
        const engagementScore = likesCount + commentsCount * 3 + retweets * 2 + Math.floor(impressions / 150);

        const place = t.geo?.place_id ? placeMap.get(t.geo.place_id) : undefined;
        const author = t.author_id ? userMap.get(t.author_id) : undefined;

        const geoCountry = place?.country_code ? place.country_code.toUpperCase() : null;
        const profileCountry = detectCountryFromText(author?.location);
        const captionCountry = detectCountryFromText(t.text);

        const detectedCountry = geoCountry || profileCountry || captionCountry;
        const locationConfidence: DiscoveredPost['locationConfidence'] = geoCountry
          ? 'verified_geo'
          : profileCountry
            ? 'profile_location'
            : captionCountry
              ? 'caption_signal'
              : 'unverified';

        const locationLabel = geoCountry
          ? `${place?.full_name || getCountryName(geoCountry)} (Verified Geo)`
          : profileCountry
            ? `${author?.location} (Profile Location)`
            : captionCountry
              ? `${getCountryName(captionCountry)} (Post Signal)`
              : author?.location
                ? `${author.location} (Profile)`
                : 'Location not tagged';

        return {
          id: t.id,
          platform: 'twitter',
          title: t.text.slice(0, 110),
          permalink: `https://x.com/i/web/status/${t.id}`,
          mediaType: 'X VIDEO',
          engagementScore,
          likesCount,
          commentsCount,
          detectedCountry,
          locationLabel,
          locationConfidence,
        };
      });
    };

    const res = await fetch(buildTwitterSearchUrl(queryStr), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json()) as Parameters<typeof parseTwitterSearch>[0] & {
      detail?: string;
      title?: string;
    };

    if (res.ok && json.data?.length) {
      const ranked = rankAndFilterDiscoveredPosts(parseTwitterSearch(json), targetCountries, minEngagement, strictGeo);
      if (ranked.length > 0) return ranked;
    }

    // Broaden search without geo-keyword restriction if geo-filtered query returned zero results, then inspect user/place geo
    if (geoTerms.length > 0) {
      const fallbackRes = await fetch(buildTwitterSearchUrl(`${baseTopic} has:videos -is:retweet`), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const fallbackJson = (await fallbackRes.json()) as Parameters<typeof parseTwitterSearch>[0];
      if (fallbackRes.ok && fallbackJson.data?.length) {
        const ranked = rankAndFilterDiscoveredPosts(
          parseTwitterSearch(fallbackJson),
          targetCountries,
          minEngagement,
          strictGeo
        );
        if (ranked.length > 0) return ranked;
      }
    }

    // Fallback to connected account timeline tweets if recent search isn't enabled on the developer tier
    const ownRes = await fetch(
      `https://api.twitter.com/2/users/${encodeURIComponent(externalId)}/tweets?max_results=20&tweet.fields=created_at,public_metrics,geo`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const ownJson = (await ownRes.json()) as {
      data?: Array<{
        id: string;
        text: string;
        public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; impression_count?: number };
      }>;
      detail?: string;
      title?: string;
    };
    if (!ownRes.ok) {
      throw new Error(json.detail || ownJson.detail || ownJson.title || `X API lookup error (${ownRes.status})`);
    }
    const mappedOwn: DiscoveredPost[] = (ownJson.data || []).map((t) => {
      const m = t.public_metrics || {};
      const likesCount = m.like_count || 0;
      const commentsCount = m.reply_count || 0;
      const engagementScore = likesCount + commentsCount * 3 + (m.retweet_count || 0) * 2;
      const detectedCountry = detectCountryFromText(t.text);
      return {
        id: t.id,
        platform: 'twitter',
        title: t.text.slice(0, 110),
        permalink: `https://x.com/i/web/status/${t.id}`,
        mediaType: 'X POST',
        engagementScore,
        likesCount,
        commentsCount,
        detectedCountry,
        locationLabel: detectedCountry ? `${getCountryName(detectedCountry)} (Post Signal)` : 'Own Timeline',
        locationConfidence: detectedCountry ? 'caption_signal' : 'unverified',
      };
    });
    return rankAndFilterDiscoveredPosts(mappedOwn, targetCountries, minEngagement, strictGeo);
  }

  return [];
}
