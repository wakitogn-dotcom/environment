import { useState } from 'react';
import {
  Play,
  Pause,
  Plus,
  Send,
  Search,
  Trash2,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  MapPin,
  TrendingUp,
} from 'lucide-react';
import { TARGET_COUNTRIES } from '../shared/countries';
import type { Campaign, DiscoveredPost, Offer, SocialAccount, TargetPostItem } from '../types';

interface CampaignsViewProps {
  campaigns: Campaign[];
  accounts: SocialAccount[];
  offers: Offer[];
  onRefresh: () => void;
}

const COUNTRY_PRESETS: Array<{ label: string; codes: string[] }> = [
  { label: 'Tier-1 Global', codes: ['US', 'GB', 'CA', 'AU'] },
  { label: 'South Asia', codes: ['BD', 'IN', 'SG', 'MY'] },
  { label: 'Middle East', codes: ['AE', 'SA'] },
  { label: 'Europe', codes: ['GB', 'DE', 'FR'] },
];

export function CampaignsView({ campaigns, accounts, offers, onRefresh }: CampaignsViewProps) {
  const [showBuilder, setShowBuilder] = useState(campaigns.length === 0);
  const [name, setName] = useState('');
  const [selectedCountries, setSelectedCountries] = useState<string[]>(['US', 'GB', 'BD']);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['facebook', 'instagram', 'twitter']);
  const [includeReels, setIncludeReels] = useState(true);
  const [humanMode, setHumanMode] = useState(true);
  const [minEngagement, setMinEngagement] = useState(5);
  const [strictGeo, setStrictGeo] = useState(false);
  const [offerId, setOfferId] = useState<string>(offers[0]?.id || '');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [targetPosts, setTargetPosts] = useState<TargetPostItem[]>([]);
  const [showManualTargets, setShowManualTargets] = useState(false);

  // Add target post/reel manually
  const [manualPlatform, setManualPlatform] = useState<'facebook' | 'instagram' | 'twitter'>('instagram');
  const [manualPostId, setManualPostId] = useState('');
  const [manualLabel, setManualLabel] = useState('');

  // Discover real active posts/reels from connected account
  const [discoverAccountId, setDiscoverAccountId] = useState(accounts[0]?.id || '');
  const [discoverKeyword, setDiscoverKeyword] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoveredItems, setDiscoveredItems] = useState<DiscoveredPost[]>([]);

  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const toggleCountry = (code: string) => {
    setSelectedCountries((prev) =>
      prev.includes(code) ? (prev.length > 1 ? prev.filter((c) => c !== code) : prev) : [...prev, code]
    );
  };

  const togglePlatform = (p: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((item) => item !== p) : prev) : [...prev, p]
    );
  };

  const addManualTarget = () => {
    if (!manualPostId.trim()) return;
    setTargetPosts((prev) => [
      ...prev,
      {
        platform: manualPlatform,
        postId: manualPostId.trim(),
        label: manualLabel.trim() || `${manualPlatform} target`,
      },
    ]);
    setManualPostId('');
    setManualLabel('');
  };

  const handleDiscover = async () => {
    const accId = discoverAccountId || accounts[0]?.id;
    if (!accId) {
      setFeedback({ type: 'error', text: 'Connect a Facebook, Instagram, or X account first to discover real-traffic Reels.' });
      return;
    }
    setDiscovering(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/social/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: accId,
          keyword: discoverKeyword.trim(),
          targetCountries: selectedCountries,
          minEngagement,
          strictGeo,
        }),
      });
      const data = (await res.json()) as {
        items?: DiscoveredPost[];
        error?: string;
      };
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Discovery failed.' });
      } else {
        setDiscoveredItems(data.items || []);
        if ((data.items || []).length === 0) {
          setFeedback({
            type: 'error',
            text: 'No active high-traffic Posts/Reels matched your location & engagement filters. Try lowering Min Engagement or adding broader keywords.',
          });
        }
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Discovery request failed.' });
    } finally {
      setDiscovering(false);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFeedback(null);
    try {
      const keywords = keywordsInput
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          target_countries: selectedCountries,
          platforms: selectedPlatforms,
          include_reels: includeReels,
          human_mode: humanMode,
          min_engagement: minEngagement,
          strict_geo: strictGeo,
          target_keywords: keywords,
          target_post_ids: targetPosts,
          offer_id: offerId || null,
          interval_minutes: intervalMinutes,
          daily_limit: dailyLimit,
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Failed to create campaign.' });
      } else {
        setName('');
        setKeywordsInput('');
        setTargetPosts([]);
        setShowBuilder(false);
        setFeedback({
          type: 'success',
          text: 'Human-mode geo-targeted campaign created. Activate it or post a live contextual comment.',
        });
        onRefresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (id: string) => {
    setFeedback(null);
    const res = await fetch(`/api/campaigns/${id}/toggle`, { method: 'POST' });
    if (res.ok) onRefresh();
  };

  const handleRunOnce = async (id: string) => {
    setRunningId(id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/run-once`, { method: 'POST' });
      const data = (await res.json()) as {
        ok?: boolean;
        platform?: string;
        country?: string;
        locationLabel?: string;
        engagementScore?: number;
        externalCommentId?: string;
        commentText?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setFeedback({ type: 'error', text: data.error || 'Comment dispatch failed.' });
      } else {
        const locNote = data.locationLabel ? ` · ${data.locationLabel}` : '';
        const engNote = typeof data.engagementScore === 'number' ? ` · Traffic Score ${data.engagementScore}` : '';
        setFeedback({
          type: 'success',
          text: `Published to ${data.platform} (${data.country}${locNote}${engNote}) · Comment ID ${data.externalCommentId}: "${data.commentText}"`,
        });
      }
      onRefresh();
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    if (res.ok) onRefresh();
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Human-Like Geo-Targeted Reels Campaigns</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Finds active high-traffic Reels matching your target countries, verifies real location signals, and writes trustworthy human replies
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowBuilder((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          {showBuilder ? 'Close Builder' : 'New Reels Campaign'}
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
              : 'bg-red-50/70 border-red-200 text-red-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-[#DC2626] mt-0.5 shrink-0" />
          )}
          <span className="break-words">{feedback.text}</span>
        </div>
      )}

      {showBuilder && (
        <form onSubmit={handleCreateCampaign} className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Campaign Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. US & UK Real-Traffic Reels CPA Push"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">CPA Offer to Promote ({'{offer_link}'})</label>
              <select
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
              >
                <option value="">None (Comments without offer link)</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.cpa_category} (/r/{o.slug})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Country Targeting */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="text-xs font-medium text-slate-700">
                Target Countries ({selectedCountries.length} selected)
              </label>
              <div className="flex flex-wrap gap-2">
                {COUNTRY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSelectedCountries(preset.codes)}
                    className="text-xs text-[#1D4ED8] hover:underline font-medium"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {TARGET_COUNTRIES.map((c) => {
                const active = selectedCountries.includes(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => toggleCountry(c.code)}
                    className={`px-2.5 py-2 text-left text-xs border rounded-lg transition-colors truncate ${
                      active
                        ? 'bg-[#1D4ED8]/10 border-[#1D4ED8] text-[#1D4ED8] font-medium'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-mono mr-1.5">{c.code}</span>
                    <span>{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Human Mode, Real Traffic & Real Geo Controls */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={humanMode}
                onChange={(e) => setHumanMode(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#1D4ED8]"
              />
              <span>
                <strong className="block text-slate-900">Human-Like Contextual Mode</strong>
                <span className="text-slate-500">
                  Replies to each video&apos;s actual topic with natural trust-building copy and randomized human timing.
                </span>
              </span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-slate-900 mb-1">
                Min. Active Traffic Score (Likes + Comments)
              </label>
              <input
                type="number"
                min={0}
                max={10000}
                value={minEngagement}
                onChange={(e) => setMinEngagement(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
              />
              <p className="mt-1 text-xs text-slate-500">Skips dead posts and targets videos with real viewers.</p>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={strictGeo}
                onChange={(e) => setStrictGeo(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#1D4ED8]"
              />
              <span>
                <strong className="block text-slate-900">Strict Real Location Match</strong>
                <span className="text-slate-500">
                  Only target videos whose verified Geo tag, author profile location, or post signals match your Target Countries.
                </span>
              </span>
            </label>
          </div>

          {/* Platform & Cadence */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
            <div>
              <span className="block text-xs font-medium text-slate-700 mb-2">Reels Video Platforms</span>
              <div className="space-y-1.5">
                {(['facebook', 'instagram', 'twitter'] as const).map((plat) => (
                  <label key={plat} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPlatforms.includes(plat)}
                      onChange={() => togglePlatform(plat)}
                      className="rounded border-slate-300 text-[#1D4ED8]"
                    />
                    <span className="capitalize">
                      {plat === 'twitter' ? 'Twitter / X Video Reels' : `${plat} Reels`}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Target Hashtags / Niche Keywords
              </label>
              <input
                type="text"
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                placeholder="deals, giveaway, finance, tech"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <p className="mt-1 text-xs text-slate-500">Comma-separated keywords to find active audience videos.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Base Interval (min)</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Daily Cap</label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Live Real-Traffic & Location Discovery Preview */}
          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Real-Traffic &amp; Location Auto-Discovery (No Link Needed)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically ranks videos by active engagement and detects real location from Geo tags, author profiles, and captions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowManualTargets((v) => !v)}
                className="text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
              >
                {showManualTargets ? 'Hide Specific Reel Overrides' : 'Optional: Add Specific Reel Links'}
              </button>
            </div>

            {accounts.length > 0 && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={discoverAccountId || accounts[0]?.id}
                    onChange={(e) => setDiscoverAccountId(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.platform.toUpperCase()} · {a.account_name} (@{a.username})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={discoverKeyword}
                    onChange={(e) => setDiscoverKeyword(e.target.value)}
                    placeholder="Optional keyword (e.g. giveaway, shopping, fitness)"
                    className="flex-1 min-w-[200px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={discovering}
                    onClick={handleDiscover}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Search className="w-3.5 h-3.5" />
                    {discovering ? 'Scanning Traffic & Geo...' : 'Scan Real Traffic & Location'}
                  </button>
                </div>

                {discoveredItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>{discoveredItems.length} active video(s) found matching filters</span>
                      <button
                        type="button"
                        onClick={() =>
                          setTargetPosts((prev) => {
                            const existingIds = new Set(prev.map((p) => p.postId));
                            const additions = discoveredItems
                              .filter((item) => !existingIds.has(item.id))
                              .map((item) => ({
                                platform: item.platform,
                                postId: item.id,
                                label: item.title.slice(0, 60),
                                detectedCountry: item.detectedCountry,
                                locationLabel: item.locationLabel,
                                engagementScore: item.engagementScore,
                              }));
                            return [...prev, ...additions];
                          })
                        }
                        className="text-[#1D4ED8] hover:underline font-medium"
                      >
                        + Attach All Active Reels
                      </button>
                    </div>
                    <div className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                      {discoveredItems.map((item) => (
                        <div key={item.id} className="px-3 py-2.5 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-slate-500">[{item.mediaType}]</span>
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-mono">
                                <TrendingUp className="w-3 h-3" />
                                {item.likesCount} likes · {item.commentsCount} comments
                              </span>
                              <span className="inline-flex items-center gap-1 text-[#1D4ED8]">
                                <MapPin className="w-3 h-3" />
                                {item.locationLabel}
                              </span>
                            </div>
                            <p className="text-slate-900 truncate">{item.title}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setTargetPosts((prev) =>
                                prev.some((p) => p.postId === item.id)
                                  ? prev
                                  : [
                                      ...prev,
                                      {
                                        platform: item.platform,
                                        postId: item.id,
                                        label: item.title.slice(0, 60),
                                        detectedCountry: item.detectedCountry,
                                        locationLabel: item.locationLabel,
                                        engagementScore: item.engagementScore,
                                      },
                                    ]
                              )
                            }
                            className="text-[#1D4ED8] hover:underline font-medium shrink-0"
                          >
                            + Attach
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showManualTargets && (
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={manualPlatform}
                  onChange={(e) => setManualPlatform(e.target.value as 'facebook' | 'instagram' | 'twitter')}
                  className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="facebook">Facebook Reel</option>
                  <option value="instagram">Instagram Reel</option>
                  <option value="twitter">Twitter / X Video</option>
                </select>
                <input
                  type="text"
                  value={manualPostId}
                  onChange={(e) => setManualPostId(e.target.value)}
                  placeholder="Optional Reel URL or ID"
                  className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  value={manualLabel}
                  onChange={(e) => setManualLabel(e.target.value)}
                  placeholder="Reel topic/title (optional)"
                  className="sm:w-44 px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={addManualTarget}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
                >
                  Add Reel
                </button>
              </div>
            )}

            {targetPosts.length > 0 && (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {targetPosts.map((t, idx) => (
                  <div key={`${t.postId}-${idx}`} className="px-3.5 py-2 flex items-center justify-between text-xs">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="capitalize font-medium text-slate-900">{t.platform}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-600 truncate">{t.postId}</span>
                      {t.locationLabel && <span className="text-[#1D4ED8] truncate">{t.locationLabel}</span>}
                      {t.label && <span className="text-slate-400 truncate">({t.label})</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setTargetPosts((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-[#DC2626]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowBuilder(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg disabled:opacity-60"
            >
              {saving ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </form>
      )}

      {/* Campaigns List */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {campaigns.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900">No campaigns created yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Create a human-mode, geo-targeted campaign above to discover real-traffic Reels and publish trustworthy comments.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {campaigns.map((camp) => (
              <div key={camp.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-sm font-semibold text-slate-900 truncate">{camp.name}</h3>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        camp.status === 'active' ? 'text-[#16A34A]' : 'text-[#D97706]'
                      }`}
                    >
                      {camp.status === 'active' ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <PauseCircle className="w-3.5 h-3.5" />
                      )}
                      {camp.status === 'active' ? 'Auto-Running' : 'Paused'}
                    </span>
                    <span className="text-xs text-slate-500">
                      · {camp.human_mode ? 'Human Contextual Mode' : 'Template Mode'}
                      {camp.strict_geo ? ' · Strict Geo' : ''}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>Countries: <strong className="font-mono text-slate-700">{camp.target_countries.join(', ')}</strong></span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">Platforms: {camp.platforms.join(', ')}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Min Traffic: {camp.min_engagement}+</span>
                    <span aria-hidden="true">·</span>
                    <span>Offer: {camp.offer ? camp.offer.name : 'None'}</span>
                  </div>

                  <div className="text-xs text-slate-500 font-mono tabular-nums">
                    Sent today: {camp.sent_today}/{camp.daily_limit} · Published: {camp.published_count} · Failed: {camp.failed_count} · ~{camp.interval_minutes}m human pacing
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(camp.id)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                      camp.status === 'active'
                        ? 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100'
                    }`}
                  >
                    {camp.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {camp.status === 'active' ? 'Pause' : 'Start Auto'}
                  </button>

                  <button
                    type="button"
                    disabled={runningId === camp.id}
                    onClick={() => handleRunOnce(camp.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {runningId === camp.id ? 'Dispatching...' : 'Post 1 Comment Now'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(camp.id)}
                    title="Delete campaign"
                    className="p-2 text-slate-400 hover:text-[#DC2626] transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
