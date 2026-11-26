import dotenv from 'dotenv';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, initDatabase } from './server/db.ts';

dotenv.config();
if (process.env.REACHPULSE_ENV_FILE && fs.existsSync(process.env.REACHPULSE_ENV_FILE)) {
  dotenv.config({ path: process.env.REACHPULSE_ENV_FILE, override: false });
}
import {
  buildMetaAuthUrl,
  buildTwitterAuthUrl,
  discoverTargetPosts,
  exchangeMetaCodeAndSaveAccounts,
  exchangeTwitterCodeAndSaveAccount,
  getAppUrl,
  getOAuthConfigStatus,
  isSafePublicUrl,
  publishSocialComment,
  verifyAndSaveDirectToken,
} from './server/social.ts';
import { getCountryName, resolveCommentTemplate } from './src/shared/countries.ts';
import {
  generateHumanVideoReply,
  generateOfferComments,
  isGeminiConfigured,
  type OfferContext,
} from './server/comments_ai.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeCsvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function renderPopupCloseHtml(payload: { ok: boolean; provider: string; message?: string; count?: number }): string {
  const safePayload = JSON.stringify({
    type: payload.ok ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR',
    provider: payload.provider,
    message: payload.message || '',
    count: payload.count || 0,
  });
  const displayMessage = payload.ok
    ? 'Account connected successfully. You can close this window.'
    : escapeHtml(payload.message || 'Authentication failed.');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>ReachPulse Authentication</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .box { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 24px 28px; max-width: 420px; text-align: center; }
      h1 { font-size: 16px; margin: 0 0 8px; }
      p { font-size: 14px; color: #475569; margin: 0; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>${payload.ok ? 'Connection Verified' : 'Connection Error'}</h1>
      <p>${displayMessage}</p>
    </div>
    <script>
      (function () {
        var msg = ${safePayload};
        if (window.opener) {
          window.opener.postMessage(msg, '*');
          if (msg.type === 'OAUTH_AUTH_SUCCESS') {
            setTimeout(function () { window.close(); }, 600);
          }
        }
      })();
    </script>
  </body>
</html>`;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  target_countries: string;
  platforms: string;
  include_reels: number;
  human_mode: number;
  min_engagement: number;
  strict_geo: number;
  target_keywords: string;
  target_post_ids: string;
  offer_id: string | null;
  comment_categories: string;
  interval_minutes: number;
  daily_limit: number;
  sent_today: number;
  total_sent: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

interface TargetPostItem {
  platform: 'facebook' | 'instagram' | 'twitter';
  postId: string;
  label?: string;
  detectedCountry?: string | null;
  locationLabel?: string;
  engagementScore?: number;
}

async function executeCampaignStep(campaignId: string): Promise<{
  ok: boolean;
  published: boolean;
  platform?: string;
  country?: string;
  locationLabel?: string;
  engagementScore?: number;
  targetPostId?: string;
  commentText?: string;
  externalCommentId?: string;
  error?: string;
}> {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as CampaignRow | undefined;
  if (!campaign) {
    return { ok: false, published: false, error: 'Campaign not found.' };
  }

  if (campaign.sent_today >= campaign.daily_limit) {
    return { ok: false, published: false, error: 'Daily comment limit reached for this campaign.' };
  }

  const platforms = safeJsonParse<string[]>(campaign.platforms, []);
  const countries = safeJsonParse<string[]>(campaign.target_countries, []);
  const targets = safeJsonParse<TargetPostItem[]>(campaign.target_post_ids, []);
  const keywords = safeJsonParse<string[]>(campaign.target_keywords, []);
  const categories = safeJsonParse<string[]>(campaign.comment_categories, ['ALL']);

  if (platforms.length === 0) {
    return { ok: false, published: false, error: 'No target platforms configured on this campaign.' };
  }

  // Pick active connected social accounts matching campaign platforms
  const accounts = db
    .prepare("SELECT id, platform, account_name, username FROM social_accounts WHERE status = 'connected'")
    .all() as Array<{ id: string; platform: string; account_name: string; username: string }>;

  const matchingAccounts = accounts.filter((acc) => platforms.includes(acc.platform));
  if (matchingAccounts.length === 0) {
    return {
      ok: false,
      published: false,
      error: 'No connected social account matches this campaign. Connect Facebook, Instagram, or X in Social Accounts.',
    };
  }

  // Track already-commented Reel IDs for this campaign to avoid duplicate comments on auto-discovered videos
  const alreadyCommentedRows = db
    .prepare("SELECT target_post_id FROM comment_logs WHERE campaign_id = ? AND delivery_status = 'published'")
    .all(campaign.id) as Array<{ target_post_id: string }>;
  const commentedIds = new Set(alreadyCommentedRows.map((r) => r.target_post_id));

  let eligiblePairs: Array<{ account: (typeof accounts)[number]; target: TargetPostItem }> = [];
  for (const target of targets) {
    if (!platforms.includes(target.platform)) continue;
    for (const acc of matchingAccounts) {
      if (acc.platform === target.platform) {
        eligiblePairs.push({ account: acc, target });
      }
    }
  }

  // Auto-discover active, geo-targeted Reels videos directly from connected accounts if no manual links were provided
  if (eligiblePairs.length === 0) {
    const discoveryErrors: string[] = [];
    const rotatedKeywords = keywords.length > 0 ? keywords : ['reels', 'trending'];
    const minEngagement = typeof campaign.min_engagement === 'number' ? campaign.min_engagement : 5;
    const strictGeo = Boolean(campaign.strict_geo);

    for (let i = 0; i < matchingAccounts.length; i += 1) {
      const acc = matchingAccounts[(campaign.total_sent + i) % matchingAccounts.length];
      const keyword = keywords.length > 0
        ? rotatedKeywords[(campaign.total_sent + i) % rotatedKeywords.length]
        : acc.platform === 'facebook'
          ? ''
          : rotatedKeywords[(campaign.total_sent + i) % rotatedKeywords.length];

      try {
        const discovered = await discoverTargetPosts({
          accountId: acc.id,
          keyword,
          targetCountries: countries,
          minEngagement,
          strictGeo,
        });
        const fresh = discovered.filter((d) => !commentedIds.has(d.id));
        for (const item of fresh) {
          eligiblePairs.push({
            account: acc,
            target: {
              platform: acc.platform as 'facebook' | 'instagram' | 'twitter',
              postId: item.id,
              label: item.title,
              detectedCountry: item.detectedCountry,
              locationLabel: item.locationLabel,
              engagementScore: item.engagementScore,
            },
          });
        }
        if (eligiblePairs.length > 0) break;
      } catch (err) {
        discoveryErrors.push(err instanceof Error ? err.message : 'Discovery failed');
      }
    }

    if (eligiblePairs.length === 0) {
      return {
        ok: false,
        published: false,
        error:
          discoveryErrors[0] ||
          'No fresh high-traffic Reels matched your target country & minimum engagement filter yet. Try lowering minimum engagement or adding broader keywords.',
      };
    }
  }

  // Pick highest-ranked un-commented pair when auto-discovered, or rotate pinned targets
  const chosen = targets.length > 0 ? eligiblePairs[campaign.total_sent % eligiblePairs.length] : eligiblePairs[0];

  // Fetch matching comment templates (prioritize templates tailored to this campaign's offer)
  let allTemplates = db
    .prepare('SELECT * FROM comment_templates ORDER BY use_count ASC, created_at ASC')
    .all() as Array<{
      id: string;
      offer_id: string | null;
      category: string;
      content: string;
      target_platforms: string;
      use_count: number;
    }>;

  let matchingTemplates = allTemplates.filter((tpl) => {
    const tplPlatforms = safeJsonParse<string[]>(tpl.target_platforms, ['facebook', 'instagram', 'twitter']);
    const platformMatch = tplPlatforms.includes(chosen.account.platform);
    const categoryMatch = categories.includes('ALL') || categories.includes(tpl.category);
    const offerMatch = !campaign.offer_id || !tpl.offer_id || tpl.offer_id === campaign.offer_id;
    return platformMatch && categoryMatch && offerMatch;
  });

  // Auto-generate offer-based comments on the fly if none exist yet for this offer
  if (matchingTemplates.length === 0 && campaign.offer_id) {
    const offerRow = db.prepare('SELECT * FROM offers WHERE id = ?').get(campaign.offer_id) as
      | {
          id: string;
          name: string;
          cpa_category?: string;
          headline: string;
          subheadline: string;
          cta_label: string;
          benefit_points: string;
          brand_name: string;
        }
      | undefined;

    if (offerRow) {
      try {
        const offerCtx: OfferContext = {
          id: offerRow.id,
          name: offerRow.name,
          cpa_category: offerRow.cpa_category || 'Other CPA Offer',
          headline: offerRow.headline,
          subheadline: offerRow.subheadline,
          cta_label: offerRow.cta_label,
          benefit_points: safeJsonParse<string[]>(offerRow.benefit_points, []),
          brand_name: offerRow.brand_name,
        };
        const generated = await generateOfferComments({
          offer: offerCtx,
          count: 10,
          language: 'English',
          platforms,
        });
        const now = new Date().toISOString();
        const insert = db.prepare(`
          INSERT INTO comment_templates (id, offer_id, category, content, language, target_platforms, use_count, created_at)
          VALUES (?, ?, ?, ?, 'English', ?, 0, ?)
        `);
        const saveTx = db.transaction(() => {
          for (const g of generated) {
            insert.run(crypto.randomUUID(), offerRow.id, g.category, g.content, JSON.stringify(platforms), now);
          }
        });
        saveTx();

        allTemplates = db
          .prepare('SELECT * FROM comment_templates ORDER BY use_count ASC, created_at ASC')
          .all() as typeof allTemplates;
        matchingTemplates = allTemplates.filter((tpl) => {
          const tplPlatforms = safeJsonParse<string[]>(tpl.target_platforms, ['facebook', 'instagram', 'twitter']);
          const platformMatch = tplPlatforms.includes(chosen.account.platform);
          const offerMatch = !tpl.offer_id || tpl.offer_id === campaign.offer_id;
          return platformMatch && offerMatch;
        });
      } catch (err) {
        return {
          ok: false,
          published: false,
          error: err instanceof Error ? err.message : 'Failed to auto-generate comments for this offer.',
        };
      }
    }
  }

  if (matchingTemplates.length === 0) {
    return {
      ok: false,
      published: false,
      error: 'No comment templates match this campaign yet. Auto-generate comments from your Offer in Comment Studio.',
    };
  }

  // Prefer real detected location from the video/author when available
  const detectedGeo = chosen.target.detectedCountry;
  const countryCode =
    detectedGeo && (countries.length === 0 || countries.includes(detectedGeo))
      ? detectedGeo
      : countries.length > 0
        ? countries[campaign.total_sent % countries.length]
        : detectedGeo || 'US';
  const countryName = getCountryName(countryCode);

  let offerLink = '';
  let offerName = '';
  let brandName = '';
  let offerCtxForReply: OfferContext | null = null;
  let preferredLanguage = 'English';

  if (campaign.offer_id) {
    const offer = db
      .prepare('SELECT * FROM offers WHERE id = ?')
      .get(campaign.offer_id) as
      | {
          id: string;
          slug: string;
          name: string;
          cpa_category?: string;
          headline: string;
          subheadline: string;
          cta_label: string;
          benefit_points: string;
          brand_name: string;
        }
      | undefined;
    if (offer) {
      offerLink = `${getAppUrl()}/r/${offer.slug}?c=${encodeURIComponent(campaign.id)}&p=${encodeURIComponent(
        chosen.account.platform
      )}&geo=${encodeURIComponent(countryCode)}`;
      offerName = offer.name;
      brandName = offer.brand_name;
      offerCtxForReply = {
        id: offer.id,
        name: offer.name,
        cpa_category: offer.cpa_category || 'CPA Offer',
        headline: offer.headline,
        subheadline: offer.subheadline,
        cta_label: offer.cta_label,
        benefit_points: safeJsonParse<string[]>(offer.benefit_points, []),
        brand_name: offer.brand_name,
      };
    }
  }

  const useContextualHumanReply =
    campaign.human_mode !== 0 &&
    isGeminiConfigured() &&
    Boolean(chosen.target.label && chosen.target.label.trim().length > 6);

  let renderedComment = '';
  let selectedTemplateId: string | null = null;

  if (useContextualHumanReply) {
    const sampleTpl = matchingTemplates[0] as { language?: string } | undefined;
    preferredLanguage = sampleTpl?.language || 'English';
    try {
      renderedComment = await generateHumanVideoReply({
        videoTitle: chosen.target.label || '',
        platform: chosen.account.platform,
        countryName,
        offer: offerCtxForReply,
        offerLink,
        language: preferredLanguage,
      });
    } catch (err) {
      return {
        ok: false,
        published: false,
        error: err instanceof Error ? err.message : 'Failed to generate contextual human reply.',
      };
    }
  } else {
    const offerSpecific = matchingTemplates.filter((t) => campaign.offer_id && t.offer_id === campaign.offer_id);
    const selectedTemplate = offerSpecific.length > 0 ? offerSpecific[0] : matchingTemplates[0];
    selectedTemplateId = selectedTemplate.id;
    renderedComment = resolveCommentTemplate(selectedTemplate.content, {
      country: countryName,
      offerLink,
      offerName,
      brand: brandName,
      platform: chosen.account.platform,
    });
  }

  const dispatchResult = await publishSocialComment({
    accountId: chosen.account.id,
    targetPostInput: chosen.target.postId,
    message: renderedComment,
  });

  const now = new Date();
  const nowIso = now.toISOString();

  // Human-like randomized pacing (±35% jitter + natural break every 5th comment)
  const baseMs = Math.max(1, campaign.interval_minutes) * 60_000;
  const jitterFactor = campaign.human_mode !== 0 ? 0.65 + Math.random() * 0.7 : 1;
  const microBreakMs =
    campaign.human_mode !== 0 && (campaign.total_sent + 1) % 5 === 0
      ? (2 + Math.floor(Math.random() * 4)) * 60_000
      : 0;
  const nextRunIso = new Date(now.getTime() + Math.round(baseMs * jitterFactor) + microBreakMs).toISOString();

  db.prepare(`
    INSERT INTO comment_logs (
      id, campaign_id, account_id, platform, country, target_post_id,
      comment_text, external_comment_id, delivery_status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    campaign.id,
    chosen.account.id,
    chosen.account.platform,
    countryCode,
    chosen.target.postId,
    renderedComment,
    dispatchResult.externalCommentId || null,
    dispatchResult.ok ? 'published' : 'failed',
    dispatchResult.error || '',
    nowIso
  );

  if (dispatchResult.ok) {
    if (selectedTemplateId) {
      db.prepare('UPDATE comment_templates SET use_count = use_count + 1 WHERE id = ?').run(selectedTemplateId);
    }
    db.prepare(
      'UPDATE campaigns SET sent_today = sent_today + 1, total_sent = total_sent + 1, last_run_at = ?, next_run_at = ? WHERE id = ?'
    ).run(nowIso, nextRunIso, campaign.id);
  } else {
    db.prepare('UPDATE campaigns SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(nowIso, nextRunIso, campaign.id);
  }

  return {
    ok: dispatchResult.ok,
    published: dispatchResult.ok,
    platform: chosen.account.platform,
    country: countryCode,
    locationLabel: chosen.target.locationLabel,
    engagementScore: chosen.target.engagementScore,
    targetPostId: chosen.target.postId,
    commentText: renderedComment,
    externalCommentId: dispatchResult.externalCommentId,
    error: dispatchResult.error,
  };
}

// ---------- OAuth Routes ----------

app.get('/api/oauth/status', (_req, res) => {
  res.json(getOAuthConfigStatus());
});

app.get('/api/oauth/meta/url', (_req, res) => {
  try {
    const url = buildMetaAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Meta OAuth not configured' });
  }
});

app.get('/api/oauth/twitter/url', (_req, res) => {
  try {
    const url = buildTwitterAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Twitter OAuth not configured' });
  }
});

app.get(['/auth/meta/callback', '/auth/meta/callback/'], async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const errorDesc = typeof req.query.error_description === 'string' ? req.query.error_description : '';

  if (errorDesc) {
    res.send(renderPopupCloseHtml({ ok: false, provider: 'meta', message: errorDesc }));
    return;
  }
  if (!code || !state) {
    res.status(400).send(renderPopupCloseHtml({ ok: false, provider: 'meta', message: 'Missing authorization code or state.' }));
    return;
  }

  try {
    const count = await exchangeMetaCodeAndSaveAccounts(code, state);
    res.send(renderPopupCloseHtml({ ok: true, provider: 'meta', count }));
  } catch (err) {
    res.status(400).send(
      renderPopupCloseHtml({
        ok: false,
        provider: 'meta',
        message: err instanceof Error ? err.message : 'Meta authentication failed.',
      })
    );
  }
});

app.get(['/auth/twitter/callback', '/auth/twitter/callback/'], async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const errorDesc = typeof req.query.error_description === 'string' ? req.query.error_description : '';

  if (errorDesc) {
    res.send(renderPopupCloseHtml({ ok: false, provider: 'twitter', message: errorDesc }));
    return;
  }
  if (!code || !state) {
    res.status(400).send(renderPopupCloseHtml({ ok: false, provider: 'twitter', message: 'Missing authorization code or state.' }));
    return;
  }

  try {
    await exchangeTwitterCodeAndSaveAccount(code, state);
    res.send(renderPopupCloseHtml({ ok: true, provider: 'twitter', count: 1 }));
  } catch (err) {
    res.status(400).send(
      renderPopupCloseHtml({
        ok: false,
        provider: 'twitter',
        message: err instanceof Error ? err.message : 'Twitter/X authentication failed.',
      })
    );
  }
});

// ---------- Social Accounts ----------

app.get('/api/accounts', (_req, res) => {
  const rows = db
    .prepare(`
      SELECT id, provider, platform, external_id, account_name, username, avatar_url,
             token_expires_at, scopes, connection_mode, status, connected_at
      FROM social_accounts
      ORDER BY connected_at DESC
    `)
    .all();
  res.json({ accounts: rows });
});

app.post('/api/accounts/connect-token', async (req, res) => {
  const { provider, accessToken } = req.body as { provider?: string; accessToken?: string };
  if (provider !== 'meta' && provider !== 'twitter') {
    res.status(400).json({ error: 'Provider must be meta or twitter.' });
    return;
  }
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    res.status(400).json({ error: 'Access token is required.' });
    return;
  }
  try {
    const result = await verifyAndSaveDirectToken(provider, accessToken);
    res.json({ ok: true, count: result.count });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Token verification failed.' });
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  const info = db.prepare('DELETE FROM social_accounts WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/social/discover', async (req, res) => {
  const { accountId, keyword, targetCountries, minEngagement, strictGeo } = req.body as {
    accountId?: string;
    keyword?: string;
    targetCountries?: string[];
    minEngagement?: number;
    strictGeo?: boolean;
  };
  if (typeof accountId !== 'string' || !accountId) {
    res.status(400).json({ error: 'accountId is required.' });
    return;
  }
  try {
    const items = await discoverTargetPosts({
      accountId,
      keyword,
      targetCountries: Array.isArray(targetCountries) ? targetCountries : [],
      minEngagement: typeof minEngagement === 'number' ? minEngagement : 1,
      strictGeo: Boolean(strictGeo),
    });
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to discover posts.' });
  }
});

app.post('/api/social/test-comment', async (req, res) => {
  const { accountId, targetPostId, message } = req.body as {
    accountId?: string;
    targetPostId?: string;
    message?: string;
  };
  if (!accountId || !targetPostId || !message) {
    res.status(400).json({ error: 'accountId, targetPostId, and message are required.' });
    return;
  }
  const result = await publishSocialComment({ accountId, targetPostInput: targetPostId, message });
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

// ---------- Unlimited Comment Templates ----------

app.get('/api/comments', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';

  const rows = db
    .prepare(`
      SELECT ct.*, o.name as offer_name
      FROM comment_templates ct
      LEFT JOIN offers o ON ct.offer_id = o.id
      ORDER BY ct.created_at DESC
    `)
    .all() as Array<{
      id: string;
      offer_id: string | null;
      offer_name: string | null;
      category: string;
      content: string;
      language: string;
      target_platforms: string;
      use_count: number;
      created_at: string;
    }>;

  const filtered = rows
    .filter((row) => {
      if (category && category !== 'ALL' && row.category !== category) return false;
      if (q && !row.content.toLowerCase().includes(q) && !row.category.toLowerCase().includes(q)) return false;
      return true;
    })
    .map((row) => ({
      ...row,
      target_platforms: safeJsonParse<string[]>(row.target_platforms, ['facebook', 'instagram', 'twitter']),
    }));

  res.json({ comments: filtered, total: rows.length });
});

app.post('/api/comments/auto-generate', async (req, res) => {
  const { offer_id, count, language, target_platforms, tone } = req.body as {
    offer_id?: string;
    count?: number;
    language?: string;
    target_platforms?: string[];
    tone?: string;
  };

  const offerRow = offer_id
    ? (db.prepare('SELECT * FROM offers WHERE id = ?').get(offer_id) as Record<string, unknown> | undefined)
    : (db.prepare('SELECT * FROM offers WHERE status = ? ORDER BY created_at DESC LIMIT 1').get('active') as
        | Record<string, unknown>
        | undefined);

  if (!offerRow) {
    res.status(400).json({ error: 'Create an Offer in Offers & Leads first so comments can be generated for it.' });
    return;
  }

  const platforms =
    Array.isArray(target_platforms) && target_platforms.length > 0
      ? target_platforms
      : ['facebook', 'instagram', 'twitter'];
  const lang = (language || 'English').slice(0, 40);

  const offerCtx: OfferContext = {
    id: String(offerRow.id),
    name: String(offerRow.name),
    cpa_category: String(offerRow.cpa_category || 'Other CPA Offer'),
    headline: String(offerRow.headline),
    subheadline: String(offerRow.subheadline || ''),
    cta_label: String(offerRow.cta_label || 'Claim Offer Now'),
    benefit_points: safeJsonParse<string[]>(String(offerRow.benefit_points || '[]'), []),
    brand_name: String(offerRow.brand_name || ''),
  };

  try {
    const generated = await generateOfferComments({
      offer: offerCtx,
      count: Number(count) || 15,
      language: lang,
      platforms,
      tone,
    });

    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO comment_templates (id, offer_id, category, content, language, target_platforms, use_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `);

    const insertTx = db.transaction(() => {
      for (const item of generated) {
        insert.run(
          crypto.randomUUID(),
          offerCtx.id,
          item.category.slice(0, 60),
          item.content.slice(0, 2000),
          lang,
          JSON.stringify(platforms),
          now
        );
      }
    });
    insertTx();

    res.status(201).json({ ok: true, inserted: generated.length, offerName: offerCtx.name });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to auto-generate comments from offer.',
    });
  }
});

app.post('/api/comments', (req, res) => {
  const { offer_id, category, content, language, target_platforms } = req.body as {
    offer_id?: string | null;
    category?: string;
    content?: string;
    language?: string;
    target_platforms?: string[];
  };
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'Comment content is required.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const platforms = Array.isArray(target_platforms) && target_platforms.length > 0
    ? target_platforms
    : ['facebook', 'instagram', 'twitter'];

  db.prepare(`
    INSERT INTO comment_templates (id, offer_id, category, content, language, target_platforms, use_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    offer_id || null,
    (category || 'Offer Hook').slice(0, 60),
    content.trim().slice(0, 2000),
    (language || 'English').slice(0, 40),
    JSON.stringify(platforms),
    now
  );

  res.status(201).json({ id });
});

app.post('/api/comments/bulk', (req, res) => {
  const { offer_id, category, lines, language, target_platforms } = req.body as {
    offer_id?: string | null;
    category?: string;
    lines?: string[];
    language?: string;
    target_platforms?: string[];
  };
  if (!Array.isArray(lines)) {
    res.status(400).json({ error: 'lines array is required.' });
    return;
  }
  const cleaned = lines.map((l) => (typeof l === 'string' ? l.trim() : '')).filter(Boolean);
  if (cleaned.length === 0) {
    res.status(400).json({ error: 'Provide at least one non-empty comment line.' });
    return;
  }
  const platforms = Array.isArray(target_platforms) && target_platforms.length > 0
    ? target_platforms
    : ['facebook', 'instagram', 'twitter'];
  const cat = (category || 'Offer Hook').slice(0, 60);
  const lang = (language || 'English').slice(0, 40);
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO comment_templates (id, offer_id, category, content, language, target_platforms, use_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const insertMany = db.transaction((items: string[]) => {
    for (const item of items) {
      insert.run(crypto.randomUUID(), offer_id || null, cat, item.slice(0, 2000), lang, JSON.stringify(platforms), now);
    }
  });
  insertMany(cleaned);

  res.status(201).json({ inserted: cleaned.length });
});

app.put('/api/comments/:id', (req, res) => {
  const { category, content, language, target_platforms } = req.body as {
    category?: string;
    content?: string;
    language?: string;
    target_platforms?: string[];
  };
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'Comment content is required.' });
    return;
  }
  const platforms = Array.isArray(target_platforms) && target_platforms.length > 0
    ? target_platforms
    : ['facebook', 'instagram', 'twitter'];

  const info = db
    .prepare('UPDATE comment_templates SET category = ?, content = ?, language = ?, target_platforms = ? WHERE id = ?')
    .run((category || 'Offer Hook').slice(0, 60), content.trim().slice(0, 2000), (language || 'English').slice(0, 40), JSON.stringify(platforms), req.params.id);

  if (info.changes === 0) {
    res.status(404).json({ error: 'Comment template not found.' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/comments/:id', (req, res) => {
  const info = db.prepare('DELETE FROM comment_templates WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Comment template not found.' });
    return;
  }
  res.json({ ok: true });
});

// ---------- Offers ----------

app.get('/api/offers', (_req, res) => {
  const rows = db.prepare('SELECT * FROM offers ORDER BY created_at DESC').all() as Array<{
    id: string;
    name: string;
    cpa_category?: string;
    slug: string;
    mode: string;
    destination_url: string;
    headline: string;
    subheadline: string;
    cta_label: string;
    benefit_points: string;
    target_countries: string;
    brand_name: string;
    status: string;
    created_at: string;
  }>;

  const clickStmt = db.prepare('SELECT COUNT(*) as cnt FROM offer_clicks WHERE offer_id = ?');
  const leadStmt = db.prepare('SELECT COUNT(*) as cnt FROM leads WHERE offer_id = ?');
  const appUrl = getAppUrl();

  const offers = rows.map((row) => {
    const clicks = (clickStmt.get(row.id) as { cnt: number }).cnt;
    const leads = (leadStmt.get(row.id) as { cnt: number }).cnt;
    return {
      ...row,
      cpa_category: row.cpa_category || 'Other CPA Offer',
      benefit_points: safeJsonParse<string[]>(row.benefit_points, []),
      target_countries: safeJsonParse<string[]>(row.target_countries, []),
      clicks,
      leads,
      tracking_url: `${appUrl}/r/${row.slug}`,
      webhook_url: `${appUrl}/api/webhooks/leads/${row.slug}`,
    };
  });

  res.json({ offers });
});

app.post('/api/offers', async (req, res) => {
  const {
    name,
    cpa_category,
    slug,
    mode,
    destination_url,
    headline,
    subheadline,
    cta_label,
    benefit_points,
    target_countries,
    brand_name,
    auto_generate_comments,
    comment_language,
  } = req.body as {
    name?: string;
    cpa_category?: string;
    slug?: string;
    mode?: string;
    destination_url?: string;
    headline?: string;
    subheadline?: string;
    cta_label?: string;
    benefit_points?: string[];
    target_countries?: string[];
    brand_name?: string;
    auto_generate_comments?: boolean;
    comment_language?: string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'Offer name is required.' });
    return;
  }

  const normalizedSlug = (slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  if (!normalizedSlug) {
    res.status(400).json({ error: 'A valid URL slug is required.' });
    return;
  }

  const offerMode = mode === 'lead_capture' ? 'lead_capture' : 'redirect';
  const cleanDest = (destination_url || '').trim();
  const cleanCategory = (cpa_category || 'Sweepstakes & Giveaways').trim().slice(0, 80);
  const cleanHeadline = (headline || '').trim() || name.trim();

  if (offerMode === 'redirect') {
    if (!cleanDest || !isSafePublicUrl(cleanDest)) {
      res.status(400).json({ error: 'Offer Link requires a valid public http(s) URL.' });
      return;
    }
  } else if (cleanDest && !isSafePublicUrl(cleanDest)) {
    res.status(400).json({ error: 'Optional destination URL must be a valid public http(s) URL.' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const cleanBenefits = Array.isArray(benefit_points) ? benefit_points.filter(Boolean).slice(0, 8) : [];

  try {
    db.prepare(`
      INSERT INTO offers (
        id, name, cpa_category, slug, mode, destination_url, headline, subheadline,
        cta_label, benefit_points, target_countries, brand_name, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      id,
      name.trim().slice(0, 120),
      cleanCategory,
      normalizedSlug,
      offerMode,
      cleanDest,
      cleanHeadline.slice(0, 200),
      (subheadline || '').trim().slice(0, 400),
      (cta_label || 'Claim Offer Now').trim().slice(0, 60),
      JSON.stringify(cleanBenefits),
      JSON.stringify(Array.isArray(target_countries) ? target_countries : []),
      (brand_name || '').trim().slice(0, 80),
      now
    );

    let autoGeneratedCount = 0;
    let autoGenerateError = '';

    if (auto_generate_comments !== false) {
      try {
        const lang = (comment_language || 'English').slice(0, 40);
        const generated = await generateOfferComments({
          offer: {
            id,
            name: name.trim(),
            cpa_category: cleanCategory,
            headline: cleanHeadline,
            subheadline: (subheadline || '').trim(),
            cta_label: (cta_label || 'Claim Offer Now').trim(),
            benefit_points: cleanBenefits,
            brand_name: (brand_name || '').trim(),
          },
          count: 15,
          language: lang,
          platforms: ['facebook', 'instagram', 'twitter'],
        });
        const insert = db.prepare(`
          INSERT INTO comment_templates (id, offer_id, category, content, language, target_platforms, use_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `);
        const tx = db.transaction(() => {
          for (const g of generated) {
            insert.run(
              crypto.randomUUID(),
              id,
              g.category.slice(0, 60),
              g.content.slice(0, 2000),
              lang,
              JSON.stringify(['facebook', 'instagram', 'twitter']),
              now
            );
          }
        });
        tx();
        autoGeneratedCount = generated.length;
      } catch (genErr) {
        autoGenerateError = genErr instanceof Error ? genErr.message : 'Comment auto-generation skipped.';
      }
    }

    res.status(201).json({
      id,
      slug: normalizedSlug,
      autoGeneratedCount,
      autoGenerateError,
    });
  } catch (err) {
    const msg = err instanceof Error && err.message.includes('UNIQUE') ? 'Slug already exists. Choose another slug.' : 'Failed to create offer.';
    res.status(400).json({ error: msg });
  }
});

app.delete('/api/offers/:id', (req, res) => {
  const info = db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Offer not found.' });
    return;
  }
  res.json({ ok: true });
});

// ---------- Campaigns ----------

app.get('/api/campaigns', (_req, res) => {
  const rows = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all() as CampaignRow[];
  const offerStmt = db.prepare('SELECT id, name, slug FROM offers WHERE id = ?');
  const logStatsStmt = db.prepare(`
    SELECT
      SUM(CASE WHEN delivery_status = 'published' THEN 1 ELSE 0 END) as published_count,
      SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) as failed_count
    FROM comment_logs WHERE campaign_id = ?
  `);

  const campaigns = rows.map((row) => {
    const offer = row.offer_id ? (offerStmt.get(row.offer_id) as { id: string; name: string; slug: string } | undefined) : undefined;
    const stats = logStatsStmt.get(row.id) as { published_count: number | null; failed_count: number | null };
    return {
      ...row,
      include_reels: Boolean(row.include_reels),
      human_mode: row.human_mode !== 0,
      min_engagement: typeof row.min_engagement === 'number' ? row.min_engagement : 5,
      strict_geo: Boolean(row.strict_geo),
      target_countries: safeJsonParse<string[]>(row.target_countries, []),
      platforms: safeJsonParse<string[]>(row.platforms, []),
      target_keywords: safeJsonParse<string[]>(row.target_keywords, []),
      target_post_ids: safeJsonParse<TargetPostItem[]>(row.target_post_ids, []),
      comment_categories: safeJsonParse<string[]>(row.comment_categories, ['ALL']),
      offer: offer || null,
      published_count: stats?.published_count || 0,
      failed_count: stats?.failed_count || 0,
    };
  });

  res.json({ campaigns });
});

app.post('/api/campaigns', (req, res) => {
  const {
    name,
    target_countries,
    platforms,
    include_reels,
    human_mode,
    min_engagement,
    strict_geo,
    target_keywords,
    target_post_ids,
    offer_id,
    comment_categories,
    interval_minutes,
    daily_limit,
  } = req.body as {
    name?: string;
    target_countries?: string[];
    platforms?: string[];
    include_reels?: boolean;
    human_mode?: boolean;
    min_engagement?: number;
    strict_geo?: boolean;
    target_keywords?: string[];
    target_post_ids?: TargetPostItem[];
    offer_id?: string | null;
    comment_categories?: string[];
    interval_minutes?: number;
    daily_limit?: number;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'Campaign name is required.' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO campaigns (
      id, name, status, target_countries, platforms, include_reels,
      human_mode, min_engagement, strict_geo,
      target_keywords, target_post_ids, offer_id, comment_categories,
      interval_minutes, daily_limit, sent_today, total_sent, created_at
    ) VALUES (?, ?, 'paused', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
  `).run(
    id,
    name.trim().slice(0, 120),
    JSON.stringify(Array.isArray(target_countries) && target_countries.length ? target_countries : ['US']),
    JSON.stringify(Array.isArray(platforms) && platforms.length ? platforms : ['facebook', 'instagram', 'twitter']),
    include_reels === false ? 0 : 1,
    human_mode === false ? 0 : 1,
    Math.max(0, Math.min(10000, Number(min_engagement) || 0)),
    strict_geo ? 1 : 0,
    JSON.stringify(Array.isArray(target_keywords) ? target_keywords : []),
    JSON.stringify(Array.isArray(target_post_ids) ? target_post_ids : []),
    offer_id || null,
    JSON.stringify(Array.isArray(comment_categories) && comment_categories.length ? comment_categories : ['ALL']),
    Math.max(1, Math.min(1440, Number(interval_minutes) || 5)),
    Math.max(1, Math.min(2000, Number(daily_limit) || 50)),
    now
  );

  res.status(201).json({ id });
});

app.put('/api/campaigns/:id', (req, res) => {
  const {
    name,
    target_countries,
    platforms,
    include_reels,
    human_mode,
    min_engagement,
    strict_geo,
    target_keywords,
    target_post_ids,
    offer_id,
    comment_categories,
    interval_minutes,
    daily_limit,
  } = req.body as {
    name?: string;
    target_countries?: string[];
    platforms?: string[];
    include_reels?: boolean;
    human_mode?: boolean;
    min_engagement?: number;
    strict_geo?: boolean;
    target_keywords?: string[];
    target_post_ids?: TargetPostItem[];
    offer_id?: string | null;
    comment_categories?: string[];
    interval_minutes?: number;
    daily_limit?: number;
  };

  const existing = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Campaign not found.' });
    return;
  }

  db.prepare(`
    UPDATE campaigns SET
      name = COALESCE(?, name),
      target_countries = COALESCE(?, target_countries),
      platforms = COALESCE(?, platforms),
      include_reels = COALESCE(?, include_reels),
      human_mode = COALESCE(?, human_mode),
      min_engagement = COALESCE(?, min_engagement),
      strict_geo = COALESCE(?, strict_geo),
      target_keywords = COALESCE(?, target_keywords),
      target_post_ids = COALESCE(?, target_post_ids),
      offer_id = ?,
      comment_categories = COALESCE(?, comment_categories),
      interval_minutes = COALESCE(?, interval_minutes),
      daily_limit = COALESCE(?, daily_limit)
    WHERE id = ?
  `).run(
    name?.trim() ? name.trim().slice(0, 120) : null,
    Array.isArray(target_countries) ? JSON.stringify(target_countries) : null,
    Array.isArray(platforms) ? JSON.stringify(platforms) : null,
    typeof include_reels === 'boolean' ? (include_reels ? 1 : 0) : null,
    typeof human_mode === 'boolean' ? (human_mode ? 1 : 0) : null,
    typeof min_engagement === 'number' ? Math.max(0, Math.min(10000, min_engagement)) : null,
    typeof strict_geo === 'boolean' ? (strict_geo ? 1 : 0) : null,
    Array.isArray(target_keywords) ? JSON.stringify(target_keywords) : null,
    Array.isArray(target_post_ids) ? JSON.stringify(target_post_ids) : null,
    offer_id || null,
    Array.isArray(comment_categories) ? JSON.stringify(comment_categories) : null,
    interval_minutes ? Math.max(1, Math.min(1440, Number(interval_minutes))) : null,
    daily_limit ? Math.max(1, Math.min(2000, Number(daily_limit))) : null,
    req.params.id
  );

  res.json({ ok: true });
});

app.post('/api/campaigns/:id/toggle', (req, res) => {
  const row = db.prepare('SELECT id, status FROM campaigns WHERE id = ?').get(req.params.id) as
    | { id: string; status: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Campaign not found.' });
    return;
  }
  const nextStatus = row.status === 'active' ? 'paused' : 'active';
  const nextRun = nextStatus === 'active' ? new Date().toISOString() : null;
  db.prepare('UPDATE campaigns SET status = ?, next_run_at = ? WHERE id = ?').run(nextStatus, nextRun, row.id);
  res.json({ ok: true, status: nextStatus });
});

app.post('/api/campaigns/:id/run-once', async (req, res) => {
  const result = await executeCampaignStep(req.params.id);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.delete('/api/campaigns/:id', (req, res) => {
  const info = db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Campaign not found.' });
    return;
  }
  res.json({ ok: true });
});

// ---------- Leads & Analytics ----------

app.get('/api/leads', (req, res) => {
  const country = typeof req.query.country === 'string' ? req.query.country.trim().toUpperCase() : '';
  const stage = typeof req.query.stage === 'string' ? req.query.stage.trim() : '';

  const rows = db
    .prepare(`
      SELECT l.*, o.name as offer_name, o.slug as offer_slug, c.name as campaign_name
      FROM leads l
      LEFT JOIN offers o ON l.offer_id = o.id
      LEFT JOIN campaigns c ON l.campaign_id = c.id
      ORDER BY l.created_at DESC
    `)
    .all() as Array<Record<string, unknown>>;

  const filtered = rows.filter((r) => {
    if (country && country !== 'ALL' && String(r.country).toUpperCase() !== country) return false;
    if (stage && stage !== 'ALL' && String(r.stage) !== stage) return false;
    return true;
  });

  res.json({ leads: filtered });
});

app.patch('/api/leads/:id', (req, res) => {
  const { stage, notes } = req.body as { stage?: string; notes?: string };
  const validStages = ['new', 'contacted', 'qualified', 'converted'];
  if (stage && !validStages.includes(stage)) {
    res.status(400).json({ error: 'Invalid lead stage.' });
    return;
  }
  const info = db
    .prepare('UPDATE leads SET stage = COALESCE(?, stage), notes = COALESCE(?, notes) WHERE id = ?')
    .run(stage || null, typeof notes === 'string' ? notes.slice(0, 1000) : null, req.params.id);

  if (info.changes === 0) {
    res.status(404).json({ error: 'Lead not found.' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/leads/:id', (req, res) => {
  const info = db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Lead not found.' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/leads/export', (_req, res) => {
  const rows = db
    .prepare(`
      SELECT l.full_name, l.email, l.phone, l.country, l.source_platform, l.stage,
             o.name as offer_name, l.notes, l.created_at
      FROM leads l
      LEFT JOIN offers o ON l.offer_id = o.id
      ORDER BY l.created_at DESC
    `)
    .all() as Array<{
      full_name: string;
      email: string;
      phone: string;
      country: string;
      source_platform: string;
      stage: string;
      offer_name: string | null;
      notes: string;
      created_at: string;
    }>;

  const header = ['Full Name', 'Email', 'Phone', 'Country', 'Platform', 'Stage', 'Offer', 'Notes', 'Captured At'];
  const csvLines = [
    header.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [
        r.full_name,
        r.email,
        r.phone,
        r.country,
        r.source_platform,
        r.stage,
        r.offer_name || '',
        r.notes,
        r.created_at,
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reachpulse-leads.csv"');
  res.send(csvLines.join('\n'));
});

app.get('/api/logs', (_req, res) => {
  const rows = db
    .prepare(`
      SELECT l.*, c.name as campaign_name, a.account_name, a.username
      FROM comment_logs l
      LEFT JOIN campaigns c ON l.campaign_id = c.id
      LEFT JOIN social_accounts a ON l.account_id = a.id
      ORDER BY l.created_at DESC
      LIMIT 100
    `)
    .all();
  res.json({ logs: rows });
});

app.get('/api/analytics/overview', (_req, res) => {
  const commentCounts = db
    .prepare(`
      SELECT
        COUNT(*) as total_attempts,
        SUM(CASE WHEN delivery_status = 'published' THEN 1 ELSE 0 END) as published,
        SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM comment_logs
    `)
    .get() as { total_attempts: number; published: number | null; failed: number | null };

  const totalClicks = (db.prepare('SELECT COUNT(*) as cnt FROM offer_clicks').get() as { cnt: number }).cnt;
  const totalLeads = (db.prepare('SELECT COUNT(*) as cnt FROM leads').get() as { cnt: number }).cnt;
  const activeCampaigns = (db.prepare("SELECT COUNT(*) as cnt FROM campaigns WHERE status = 'active'").get() as { cnt: number }).cnt;
  const connectedAccounts = (db.prepare("SELECT COUNT(*) as cnt FROM social_accounts WHERE status = 'connected'").get() as { cnt: number }).cnt;
  const totalTemplates = (db.prepare('SELECT COUNT(*) as cnt FROM comment_templates').get() as { cnt: number }).cnt;

  const clicksByCountry = db
    .prepare('SELECT country, COUNT(*) as clicks FROM offer_clicks GROUP BY country')
    .all() as Array<{ country: string; clicks: number }>;
  const leadsByCountry = db
    .prepare('SELECT country, COUNT(*) as leads FROM leads GROUP BY country')
    .all() as Array<{ country: string; leads: number }>;
  const commentsByCountry = db
    .prepare("SELECT country, COUNT(*) as comments FROM comment_logs WHERE delivery_status = 'published' GROUP BY country")
    .all() as Array<{ country: string; comments: number }>;

  const countryMap = new Map<string, { country: string; name: string; comments: number; clicks: number; leads: number }>();
  const ensureCountry = (code: string) => {
    const key = (code || 'UNKNOWN').toUpperCase();
    if (!countryMap.has(key)) {
      countryMap.set(key, { country: key, name: getCountryName(key), comments: 0, clicks: 0, leads: 0 });
    }
    return countryMap.get(key)!;
  };

  for (const row of commentsByCountry) ensureCountry(row.country).comments = row.comments;
  for (const row of clicksByCountry) ensureCountry(row.country).clicks = row.clicks;
  for (const row of leadsByCountry) ensureCountry(row.country).leads = row.leads;

  const countryBreakdown = Array.from(countryMap.values()).sort(
    (a, b) => b.leads + b.clicks + b.comments - (a.leads + a.clicks + a.comments)
  );

  const platformBreakdown = db
    .prepare(`
      SELECT platform,
        SUM(CASE WHEN delivery_status = 'published' THEN 1 ELSE 0 END) as published,
        SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM comment_logs
      GROUP BY platform
    `)
    .all();

  const recentLogs = db
    .prepare(`
      SELECT l.*, c.name as campaign_name
      FROM comment_logs l
      LEFT JOIN campaigns c ON l.campaign_id = c.id
      ORDER BY l.created_at DESC
      LIMIT 12
    `)
    .all();

  const conversionRate = totalClicks > 0 ? Number(((totalLeads / totalClicks) * 100).toFixed(1)) : 0;

  res.json({
    summary: {
      publishedComments: commentCounts.published || 0,
      failedComments: commentCounts.failed || 0,
      totalClicks,
      totalLeads,
      conversionRate,
      activeCampaigns,
      connectedAccounts,
      totalTemplates,
    },
    countryBreakdown,
    platformBreakdown,
    recentLogs,
  });
});

// ---------- Public Offer Tracking & Lead Capture ----------

app.get('/api/public/offers/:slug', (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE slug = ? AND status = ?').get(req.params.slug, 'active') as
    | {
        id: string;
        name: string;
        slug: string;
        mode: string;
        destination_url: string;
        headline: string;
        subheadline: string;
        cta_label: string;
        benefit_points: string;
        target_countries: string;
        brand_name: string;
      }
    | undefined;

  if (!offer) {
    res.status(404).json({ error: 'Offer not found or paused.' });
    return;
  }

  res.json({
    offer: {
      id: offer.id,
      name: offer.name,
      slug: offer.slug,
      mode: offer.mode,
      destination_url: offer.destination_url,
      headline: offer.headline,
      subheadline: offer.subheadline,
      cta_label: offer.cta_label,
      benefit_points: safeJsonParse<string[]>(offer.benefit_points, []),
      target_countries: safeJsonParse<string[]>(offer.target_countries, []),
      brand_name: offer.brand_name,
    },
  });
});

app.post('/api/public/leads', (req, res) => {
  const { offer_slug, campaign_id, full_name, email, phone, country, source_platform, notes } = req.body as {
    offer_slug?: string;
    campaign_id?: string;
    full_name?: string;
    email?: string;
    phone?: string;
    country?: string;
    source_platform?: string;
    notes?: string;
  };

  if (!offer_slug || !full_name?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'Full name, valid email, and offer are required.' });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const offer = db.prepare('SELECT id, destination_url FROM offers WHERE slug = ?').get(offer_slug) as
    | { id: string; destination_url: string }
    | undefined;
  if (!offer) {
    res.status(404).json({ error: 'Offer not found.' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO leads (
      id, offer_id, campaign_id, full_name, email, phone, country, source_platform, notes, stage, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
  `).run(
    id,
    offer.id,
    campaign_id || null,
    full_name.trim().slice(0, 120),
    email.trim().slice(0, 160),
    (phone || '').trim().slice(0, 40),
    (country || 'US').trim().toUpperCase().slice(0, 10),
    (source_platform || 'direct').trim().slice(0, 30),
    (notes || '').trim().slice(0, 600),
    now
  );

  res.status(201).json({
    ok: true,
    leadId: id,
    destinationUrl: offer.destination_url && isSafePublicUrl(offer.destination_url) ? offer.destination_url : null,
  });
});

app.post('/api/webhooks/leads/:slug', (req, res) => {
  const offer = db.prepare('SELECT id FROM offers WHERE slug = ?').get(req.params.slug) as { id: string } | undefined;
  if (!offer) {
    res.status(404).json({ error: 'Offer slug not found.' });
    return;
  }
  const { full_name, name, email, phone, country, source_platform, campaign_id, notes } = req.body as Record<string, string>;
  const resolvedName = (full_name || name || '').trim();
  const resolvedEmail = (email || '').trim();
  if (!resolvedName || !resolvedEmail) {
    res.status(400).json({ error: 'name/full_name and email are required.' });
    return;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO leads (
      id, offer_id, campaign_id, full_name, email, phone, country, source_platform, notes, stage, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
  `).run(
    id,
    offer.id,
    campaign_id || null,
    resolvedName.slice(0, 120),
    resolvedEmail.slice(0, 160),
    (phone || '').slice(0, 40),
    (country || 'US').toUpperCase().slice(0, 10),
    (source_platform || 'webhook').slice(0, 30),
    (notes || '').slice(0, 600),
    new Date().toISOString()
  );

  res.status(201).json({ ok: true, leadId: id });
});

// Tracking link handler `/r/:slug`
app.get('/r/:slug', (req, res, next) => {
  const offer = db.prepare('SELECT * FROM offers WHERE slug = ? AND status = ?').get(req.params.slug, 'active') as
    | { id: string; mode: string; destination_url: string; name: string }
    | undefined;

  if (!offer) {
    next();
    return;
  }

  const campaignId = typeof req.query.c === 'string' ? req.query.c : null;
  const platform = typeof req.query.p === 'string' ? req.query.p : 'direct';
  const queryGeo = typeof req.query.geo === 'string' ? req.query.geo : '';
  const headerGeo =
    (typeof req.headers['cf-ipcountry'] === 'string' && req.headers['cf-ipcountry']) ||
    (typeof req.headers['x-appengine-country'] === 'string' && req.headers['x-appengine-country']) ||
    '';
  const country = (queryGeo || headerGeo || 'US').toUpperCase().slice(0, 10);

  db.prepare(`
    INSERT INTO offer_clicks (id, offer_id, campaign_id, platform, country, referrer, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    offer.id,
    campaignId,
    platform.slice(0, 30),
    country,
    String(req.headers.referer || '').slice(0, 300),
    String(req.headers['user-agent'] || '').slice(0, 300),
    new Date().toISOString()
  );

  if (offer.mode === 'redirect' && offer.destination_url && isSafePublicUrl(offer.destination_url)) {
    const dest = new URL(offer.destination_url);
    dest.searchParams.set('utm_source', platform);
    dest.searchParams.set('utm_medium', 'social_comment');
    if (campaignId) dest.searchParams.set('utm_campaign', campaignId);
    res.redirect(302, dest.toString());
    return;
  }

  // Serve SPA route `/r/:slug` for lead capture landing page
  next();
});

// ---------- Automated Background Campaign Scheduler & Server Boot ----------

let schedulerBusy = false;

async function startServer() {
  await initDatabase();

  setInterval(async () => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      const nowIso = new Date().toISOString();
      const dueCampaigns = db
        .prepare("SELECT id FROM campaigns WHERE status = 'active' AND (next_run_at IS NULL OR next_run_at <= ?) LIMIT 5")
        .all(nowIso) as Array<{ id: string }>;

      for (const c of dueCampaigns) {
        await executeCampaignStep(c.id);
      }
    } catch (err) {
      console.error('Campaign scheduler error:', err);
    } finally {
      schedulerBusy = false;
    }
  }, 15_000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = process.env.REACHPULSE_DIST_DIR
      ? path.resolve(process.env.REACHPULSE_DIST_DIR)
      : path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const host = process.env.ELECTRON_DESKTOP === 'true' ? '127.0.0.1' : '0.0.0.0';
  app.listen(PORT, host, () => {
    console.log(`ReachPulse server listening on http://${host}:${PORT}`);
  });
}

startServer();
