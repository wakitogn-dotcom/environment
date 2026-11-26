import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.REACHPULSE_DATA_DIR
  ? path.resolve(process.env.REACHPULSE_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'reachpulse.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Persistent server-side encryption key for OAuth tokens stored at rest.
// Uses process.env.TOKEN_ENCRYPTION_KEY when provided, or a generated key stored in data/.vault.key
// so tokens remain decryptable across server restarts without hardcoding secrets.
function loadOrCreateEncryptionKey(): Buffer {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (envKey) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  const keyFile = path.join(DATA_DIR, '.vault.key');
  if (fs.existsSync(keyFile)) {
    const hex = fs.readFileSync(keyFile, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      return Buffer.from(hex, 'hex');
    }
  }
  const fresh = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, fresh.toString('hex'), { mode: 0o600 });
  return fresh;
}

const ENCRYPTION_KEY = loadOrCreateEncryptionKey();

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(':');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      platform TEXT NOT NULL,
      external_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT,
      token_expires_at INTEGER,
      scopes TEXT DEFAULT '',
      connection_mode TEXT NOT NULL DEFAULT 'oauth',
      status TEXT NOT NULL DEFAULT 'connected',
      connected_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_social_platform_ext
      ON social_accounts(platform, external_id);

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cpa_category TEXT NOT NULL DEFAULT 'Other CPA Offer',
      slug TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'redirect',
      destination_url TEXT DEFAULT '',
      headline TEXT NOT NULL,
      subheadline TEXT DEFAULT '',
      cta_label TEXT NOT NULL DEFAULT 'Claim Offer Now',
      benefit_points TEXT NOT NULL DEFAULT '[]',
      target_countries TEXT NOT NULL DEFAULT '[]',
      brand_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comment_templates (
      id TEXT PRIMARY KEY,
      offer_id TEXT,
      category TEXT NOT NULL DEFAULT 'Offer Hook',
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'English',
      target_platforms TEXT NOT NULL DEFAULT '["facebook","instagram","twitter"]',
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paused',
      target_countries TEXT NOT NULL DEFAULT '[]',
      platforms TEXT NOT NULL DEFAULT '[]',
      include_reels INTEGER NOT NULL DEFAULT 1,
      human_mode INTEGER NOT NULL DEFAULT 1,
      min_engagement INTEGER NOT NULL DEFAULT 5,
      strict_geo INTEGER NOT NULL DEFAULT 0,
      target_keywords TEXT NOT NULL DEFAULT '[]',
      target_post_ids TEXT NOT NULL DEFAULT '[]',
      offer_id TEXT,
      comment_categories TEXT NOT NULL DEFAULT '["ALL"]',
      interval_minutes INTEGER NOT NULL DEFAULT 5,
      daily_limit INTEGER NOT NULL DEFAULT 50,
      sent_today INTEGER NOT NULL DEFAULT 0,
      total_sent INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comment_logs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      account_id TEXT,
      platform TEXT NOT NULL,
      country TEXT NOT NULL,
      target_post_id TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      external_comment_id TEXT,
      delivery_status TEXT NOT NULL,
      error_message TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offer_clicks (
      id TEXT PRIMARY KEY,
      offer_id TEXT NOT NULL,
      campaign_id TEXT,
      platform TEXT DEFAULT 'direct',
      country TEXT DEFAULT 'UNKNOWN',
      referrer TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      offer_id TEXT NOT NULL,
      campaign_id TEXT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      country TEXT NOT NULL,
      source_platform TEXT DEFAULT 'direct',
      notes TEXT DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );
  `);

  const cols = db.prepare('PRAGMA table_info(comment_templates)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'offer_id')) {
    db.exec('ALTER TABLE comment_templates ADD COLUMN offer_id TEXT');
  }

  const offerCols = db.prepare('PRAGMA table_info(offers)').all() as Array<{ name: string }>;
  if (!offerCols.some((c) => c.name === 'cpa_category')) {
    db.exec("ALTER TABLE offers ADD COLUMN cpa_category TEXT NOT NULL DEFAULT 'Other CPA Offer'");
  }

  const campCols = db.prepare('PRAGMA table_info(campaigns)').all() as Array<{ name: string }>;
  if (!campCols.some((c) => c.name === 'human_mode')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN human_mode INTEGER NOT NULL DEFAULT 1');
  }
  if (!campCols.some((c) => c.name === 'min_engagement')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN min_engagement INTEGER NOT NULL DEFAULT 5');
  }
  if (!campCols.some((c) => c.name === 'strict_geo')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN strict_geo INTEGER NOT NULL DEFAULT 0');
  }
}
