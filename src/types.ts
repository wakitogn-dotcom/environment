export interface SocialAccount {
  id: string;
  provider: 'meta' | 'twitter';
  platform: 'facebook' | 'instagram' | 'twitter';
  external_id: string;
  account_name: string;
  username: string;
  avatar_url: string;
  token_expires_at: number | null;
  scopes: string;
  connection_mode: 'oauth' | 'token';
  status: 'connected' | 'expired' | 'error';
  connected_at: string;
}

export interface OAuthStatus {
  appUrl: string;
  meta: {
    configured: boolean;
    callbackUrl: string;
    scopes: string[];
  };
  twitter: {
    configured: boolean;
    callbackUrl: string;
    scopes: string[];
  };
}

export interface CommentTemplate {
  id: string;
  offer_id?: string | null;
  offer_name?: string | null;
  category: string;
  content: string;
  language: string;
  target_platforms: string[];
  use_count: number;
  created_at: string;
}

export interface Offer {
  id: string;
  name: string;
  cpa_category: string;
  slug: string;
  mode: 'lead_capture' | 'redirect';
  destination_url: string;
  headline: string;
  subheadline: string;
  cta_label: string;
  benefit_points: string[];
  target_countries: string[];
  brand_name: string;
  status: 'active' | 'paused';
  created_at: string;
  clicks: number;
  leads: number;
  tracking_url: string;
  webhook_url: string;
}

export interface TargetPostItem {
  platform: 'facebook' | 'instagram' | 'twitter';
  postId: string;
  label?: string;
  detectedCountry?: string | null;
  locationLabel?: string;
  engagementScore?: number;
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

export interface Campaign {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed';
  target_countries: string[];
  platforms: string[];
  include_reels: boolean;
  human_mode: boolean;
  min_engagement: number;
  strict_geo: boolean;
  target_keywords: string[];
  target_post_ids: TargetPostItem[];
  offer_id: string | null;
  offer: { id: string; name: string; slug: string } | null;
  comment_categories: string[];
  interval_minutes: number;
  daily_limit: number;
  sent_today: number;
  total_sent: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  published_count: number;
  failed_count: number;
}

export interface Lead {
  id: string;
  offer_id: string;
  campaign_id: string | null;
  full_name: string;
  email: string;
  phone: string;
  country: string;
  source_platform: string;
  notes: string;
  stage: 'new' | 'contacted' | 'qualified' | 'converted';
  created_at: string;
  offer_name?: string;
  offer_slug?: string;
  campaign_name?: string;
}

export interface CommentLog {
  id: string;
  campaign_id: string;
  campaign_name?: string;
  account_id: string;
  account_name?: string;
  username?: string;
  platform: string;
  country: string;
  target_post_id: string;
  comment_text: string;
  external_comment_id: string | null;
  delivery_status: 'published' | 'failed';
  error_message: string;
  created_at: string;
}

export interface AnalyticsOverview {
  summary: {
    publishedComments: number;
    failedComments: number;
    totalClicks: number;
    totalLeads: number;
    conversionRate: number;
    activeCampaigns: number;
    connectedAccounts: number;
    totalTemplates: number;
  };
  countryBreakdown: Array<{
    country: string;
    name: string;
    comments: number;
    clicks: number;
    leads: number;
  }>;
  platformBreakdown: Array<{
    platform: string;
    published: number;
    failed: number;
  }>;
  recentLogs: CommentLog[];
}
