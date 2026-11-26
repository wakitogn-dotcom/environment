import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Search, Trash2, Upload, Copy, Check, Wand2 } from 'lucide-react';
import { TARGET_COUNTRIES, resolveCommentTemplate } from '../shared/countries';
import type { CommentTemplate, Offer } from '../types';

interface CommentStudioViewProps {
  comments: CommentTemplate[];
  offers: Offer[];
  onRefresh: () => void;
}

const CATEGORIES = ['Offer Hook', 'Reels Viral', 'Question CTA', 'Social Proof', 'Custom'];
const LANGUAGES = ['English', 'Bengali', 'Banglish', 'Multilingual'];
const TONES = ['Natural & Engaging Reels Hook', 'Direct Deal CTA', 'Curiosity Question', 'Social Proof & Recommendation'];

export function CommentStudioView({ comments, offers, onRefresh }: CommentStudioViewProps) {
  const [mode, setMode] = useState<'auto' | 'single' | 'bulk'>('auto');
  const [selectedOfferId, setSelectedOfferId] = useState<string>(offers[0]?.id || '');
  const [autoCount, setAutoCount] = useState(15);
  const [autoTone, setAutoTone] = useState(TONES[0]);

  const [category, setCategory] = useState('Offer Hook');
  const [language, setLanguage] = useState('English');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['facebook', 'instagram', 'twitter']);
  const [singleText, setSingleText] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');

  // Spintax & Country Live Previewer
  const [previewCountry, setPreviewCountry] = useState('US');
  const [previewOfferId, setPreviewOfferId] = useState<string>(offers[0]?.id || '');
  const [previewPlatform, setPreviewPlatform] = useState('instagram');
  const [previewSeed, setPreviewSeed] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedOfferId && offers[0]?.id) {
      setSelectedOfferId(offers[0].id);
    }
    if (!previewOfferId && offers[0]?.id) {
      setPreviewOfferId(offers[0].id);
    }
  }, [offers, selectedOfferId, previewOfferId]);

  const togglePlatform = (p: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((item) => item !== p) : prev) : [...prev, p]
    );
  };

  const insertToken = (token: string) => {
    if (mode === 'single') {
      setSingleText((prev) => (prev ? `${prev} ${token}` : token));
    } else if (mode === 'bulk') {
      setBulkText((prev) => (prev ? `${prev} ${token}` : token));
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    setMode('bulk');
    setBulkText((prev) => (prev ? `${prev}\n${lines.join('\n')}` : lines.join('\n')));
    e.target.value = '';
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (mode === 'auto') {
        const res = await fetch('/api/comments/auto-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offer_id: selectedOfferId || undefined,
            count: autoCount,
            language,
            tone: autoTone,
            target_platforms: selectedPlatforms,
          }),
        });
        const data = (await res.json()) as { inserted?: number; offerName?: string; error?: string };
        if (!res.ok) {
          setFeedback({ type: 'error', text: data.error || 'Could not auto-generate comments.' });
        } else {
          setFeedback({
            type: 'success',
            text: `Auto-generated ${data.inserted || autoCount} Reels comments tailored to "${data.offerName}".`,
          });
          onRefresh();
        }
        return;
      }

      if (mode === 'single') {
        if (!singleText.trim()) return;
        const res = await fetch('/api/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offer_id: selectedOfferId || null,
            category,
            language,
            content: singleText.trim(),
            target_platforms: selectedPlatforms,
          }),
        });
        if (res.ok) {
          setSingleText('');
          setFeedback({ type: 'success', text: 'Comment template added to your pool.' });
          onRefresh();
        }
      } else {
        const lines = bulkText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) return;
        const res = await fetch('/api/comments/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offer_id: selectedOfferId || null,
            category,
            language,
            lines,
            target_platforms: selectedPlatforms,
          }),
        });
        const data = (await res.json()) as { inserted?: number };
        if (res.ok) {
          setBulkText('');
          setFeedback({ type: 'success', text: `Added ${data.inserted || lines.length} custom comment lines.` });
          onRefresh();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
    if (res.ok) onRefresh();
  };

  const handleCopyPreview = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1400);
  };

  const filteredComments = comments.filter((c) => {
    if (filterCategory !== 'ALL' && c.category !== filterCategory) return false;
    if (searchQuery.trim() && !c.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const activeOffer = offers.find((o) => o.id === (mode === 'auto' ? selectedOfferId : previewOfferId)) || offers[0];
  const countryName = TARGET_COUNTRIES.find((c) => c.code === previewCountry)?.name || previewCountry;
  const activeDraft =
    mode === 'single'
      ? singleText
      : mode === 'bulk'
        ? bulkText.split(/\r?\n/).find((l) => l.trim()) || ''
        : comments.find((c) => !activeOffer || c.offer_id === activeOffer.id)?.content || comments[0]?.content || '';

  const previewRendered =
    activeDraft.trim().length > 0
      ? resolveCommentTemplate(activeDraft, {
          country: countryName,
          offerLink: activeOffer
            ? `${activeOffer.tracking_url}?geo=${previewCountry}&p=${previewPlatform}`
            : 'https://your-offer-link/r/offer',
          offerName: activeOffer?.name || 'Special Offer',
          brand: activeOffer?.brand_name || 'Your Brand',
          platform: previewPlatform,
        })
      : '';

  return (
    <div className="space-y-8">
      {/* Creator + Live Preview Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <form
          onSubmit={handleSave}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between gap-5"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Offer-Based Reels Comment Studio</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Auto-generate tailored Reels comments directly from any Offer, or author unlimited lines yourself.
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMode('auto')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'auto' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Auto by Offer
                </button>
                <button
                  type="button"
                  onClick={() => setMode('single')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'single' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setMode('bulk')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'bulk' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Bulk Lines
                </button>
              </div>
            </div>

            {feedback && (
              <div
                className={`px-3.5 py-2.5 rounded-lg border text-xs ${
                  feedback.type === 'success'
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-red-50/70 border-red-200 text-red-900'
                }`}
              >
                {feedback.text}
              </div>
            )}

            {mode === 'auto' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Select Offer</label>
                  <select
                    value={selectedOfferId}
                    onChange={(e) => setSelectedOfferId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
                  >
                    {offers.length === 0 ? (
                      <option value="">No offers created yet — create an Offer in Offers &amp; Leads first</option>
                    ) : (
                      offers.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} — {o.headline.slice(0, 60)}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Comments to Generate</label>
                    <select
                      value={autoCount}
                      onChange={(e) => setAutoCount(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
                    >
                      <option value={10}>10 comments</option>
                      <option value={15}>15 comments</option>
                      <option value={25}>25 comments</option>
                      <option value={40}>40 comments</option>
                      <option value={50}>50 comments</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Language</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Comment Angle</label>
                    <select
                      value={autoTone}
                      onChange={(e) => setAutoTone(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      {TONES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                  Comments are generated automatically from your selected Offer headline, benefits, and CTA with{' '}
                  <span className="font-mono text-slate-700">{'{offer_link}'}</span> and{' '}
                  <span className="font-mono text-slate-700">{'{country}'}</span> injected cleanly.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Linked Offer (Optional)</label>
                    <select
                      value={selectedOfferId}
                      onChange={(e) => setSelectedOfferId(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="">All Offers</option>
                      {offers.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Language</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-700">
                      {mode === 'single' ? 'Comment Text (Spintax Supported)' : 'Unlimited Comment Lines (1 comment per line)'}
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1D4ED8] hover:underline cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      Import .txt / .csv
                      <input type="file" accept=".txt,.csv" onChange={handleFileImport} className="hidden" />
                    </label>
                  </div>

                  {mode === 'single' ? (
                    <textarea
                      rows={4}
                      value={singleText}
                      onChange={(e) => setSingleText(e.target.value)}
                      placeholder="{Hey|Hi|Hello} from {brand}! Anyone in {country} looking for {offer_name}? Grab it here: {offer_link}"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                    />
                  ) : (
                    <textarea
                      rows={6}
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      placeholder={`Line 1: {Hey|Hi} {country} creators! Check {offer_name} at {offer_link}\nLine 2: Loving this Reel! If you're in {country}, don't miss {offer_link}`}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] font-mono text-xs leading-relaxed"
                    />
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-slate-500 mr-1">Insert token:</span>
                    {['{country}', '{offer_link}', '{offer_name}', '{brand}', '{Hi|Hello|Hey}'].map((tok) => (
                      <button
                        key={tok}
                        type="button"
                        onClick={() => insertToken(tok)}
                        className="px-2 py-1 text-xs font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
                      >
                        {tok}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">Target Reels Platforms</span>
              <div className="flex flex-wrap gap-3">
                {(['facebook', 'instagram', 'twitter'] as const).map((plat) => (
                  <label key={plat} className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPlatforms.includes(plat)}
                      onChange={() => togglePlatform(plat)}
                      className="rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
                    />
                    <span className="capitalize">{plat === 'twitter' ? 'Twitter / X Video' : `${plat} Reels`}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <span className="text-xs text-slate-500 tabular-nums">{comments.length} total templates stored</span>
            <button
              type="submit"
              disabled={saving || (mode === 'auto' && offers.length === 0)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {mode === 'auto' ? <Wand2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {saving
                ? mode === 'auto'
                  ? 'Generating Comments...'
                  : 'Saving...'
                : mode === 'auto'
                  ? `Auto-Generate ${autoCount} Comments`
                  : mode === 'single'
                    ? 'Save Comment'
                    : 'Add All Lines'}
            </button>
          </div>
        </form>

        {/* Live Spintax & Country Previewer */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Live Variation Preview</h2>
                <p className="text-xs text-slate-500 mt-0.5">Preview how generated comments render with your tracking link</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSeed((s) => s + 1)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Spin
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Preview Country</label>
                <select
                  value={previewCountry}
                  onChange={(e) => setPreviewCountry(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  {TARGET_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Platform</label>
                <select
                  value={previewPlatform}
                  onChange={(e) => setPreviewPlatform(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="facebook">Facebook Reels</option>
                  <option value="instagram">Instagram Reels</option>
                  <option value="twitter">Twitter / X Video</option>
                </select>
              </div>
            </div>

            <div key={previewSeed} className="p-4 bg-slate-50 border border-slate-200 rounded-lg min-h-[140px]">
              <p className="text-xs text-slate-500 mb-2">
                {previewPlatform} · {countryName}
              </p>
              {previewRendered ? (
                <p className="text-sm text-slate-900 leading-relaxed break-words">{previewRendered}</p>
              ) : (
                <p className="text-xs text-slate-400">
                  Click Auto-Generate on the left to build Offer-tailored Reels comments automatically.
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Campaigns automatically pick comments linked to their Offer and rotate them across Reels videos.
          </p>
        </section>
      </div>

      {/* Saved Comment Library */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Your Comment Text Library ({comments.length})</h2>
            <p className="text-xs text-slate-500 mt-0.5">Auto-rotated across Reels campaigns based on Offer</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search comments..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="ALL">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredComments.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900">No comment templates found</p>
            <p className="mt-1 text-xs text-slate-500">
              Select an Offer above and click Auto-Generate Comments to create tailored Reels comments automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredComments.map((item) => (
              <div key={item.id} className="px-5 py-3.5 flex items-start justify-between gap-4 hover:bg-slate-50/70">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-800">{item.category}</span>
                    {item.offer_name && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#1D4ED8] font-medium">{item.offer_name}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{item.language}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{item.target_platforms.join(', ')}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Used {item.use_count}x</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-900 break-words">{item.content}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyPreview(item.id, item.content)}
                    title="Copy comment template"
                    className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    title="Delete template"
                    className="p-1.5 text-slate-400 hover:text-[#DC2626] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
