import { CheckCircle2, AlertCircle, ArrowUpRight, Globe2 } from 'lucide-react';
import type { AnalyticsOverview } from '../types';

interface OverviewViewProps {
  analytics: AnalyticsOverview | null;
  loading: boolean;
  onNavigate: (tab: 'overview' | 'campaigns' | 'comments' | 'offers' | 'accounts') => void;
}

export function OverviewView({ analytics, loading, onNavigate }: OverviewViewProps) {
  if (loading && !analytics) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  const summary = analytics?.summary ?? {
    publishedComments: 0,
    failedComments: 0,
    totalClicks: 0,
    totalLeads: 0,
    conversionRate: 0,
    activeCampaigns: 0,
    connectedAccounts: 0,
    totalTemplates: 0,
  };

  const countryBreakdown = analytics?.countryBreakdown ?? [];
  const recentLogs = analytics?.recentLogs ?? [];

  return (
    <div className="space-y-8">
      {/* 4-Column Tabular KPI Strip */}
      <section aria-label="Key Performance Metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Reels Comments Published</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {summary.publishedComments.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {summary.activeCampaigns} active Reels campaigns · {summary.connectedAccounts} connected accounts
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Reels Offer Clicks</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {summary.totalClicks.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            Traffic from Facebook Reels, IG Reels &amp; X Video
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Captured Leads</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {summary.totalLeads.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {summary.conversionRate}% click-to-lead conversion
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Reels Comment Pool</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {summary.totalTemplates.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {summary.failedComments} failed deliveries logged
          </p>
        </div>
      </section>

      {/* Setup Checklist if user hasn't connected or created assets yet */}
      {(summary.connectedAccounts === 0 || summary.totalTemplates === 0 || summary.activeCampaigns === 0) && (
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-slate-900">Reels Auto-Marketing Launch Checklist</h2>
          <p className="mt-1 text-sm text-slate-600">
            Complete these steps to automate country-targeted comments on Facebook Reels, Instagram Reels, and X Videos.
          </p>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200 pt-5">
            <div className="flex flex-col justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">01 · Social OAuth</p>
                <p className="mt-1 text-sm font-medium text-slate-900">Connect Facebook, Instagram &amp; X</p>
                <p className="mt-1 text-xs text-slate-600">
                  Authorize real pages, Instagram Business Reels, or X accounts via OAuth or verified access tokens.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('accounts')}
                className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
              >
                {summary.connectedAccounts > 0 ? `${summary.connectedAccounts} connected` : 'Connect Accounts'}
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex flex-col justify-between gap-3 md:border-l md:border-slate-200 md:pl-4">
              <div>
                <p className="text-xs font-medium text-slate-500">02 · Comment &amp; Offer Assets</p>
                <p className="mt-1 text-sm font-medium text-slate-900">Author Comment Texts &amp; Offer Links</p>
                <p className="mt-1 text-xs text-slate-600">
                  Add unlimited comment variations with spintax and create a live offer tracking link for lead capture.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => onNavigate('comments')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
                >
                  Comment Studio ({summary.totalTemplates})
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('offers')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
                >
                  Offers &amp; Leads
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3 md:border-l md:border-slate-200 md:pl-4">
              <div>
                <p className="text-xs font-medium text-slate-500">03 · Country Campaign</p>
                <p className="mt-1 text-sm font-medium text-slate-900">Target Countries &amp; Run Dispatch</p>
                <p className="mt-1 text-xs text-slate-600">
                  Pick target countries, attach Posts or Reels IDs, and activate automated comment rotation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('campaigns')}
                className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
              >
                Open Campaigns
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Country Breakdown & Recent Comment Dispatches */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Country Targeting Performance</h2>
              <p className="text-xs text-slate-500 mt-0.5">Comments, offer traffic, and leads by country</p>
            </div>
            <Globe2 className="w-4 h-4 text-slate-400" />
          </div>

          {countryBreakdown.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-900">No country traffic recorded yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Country breakdown populates automatically as comments publish and visitors click your offer links.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-4 font-medium">Country</th>
                    <th className="py-2.5 px-3 font-medium text-right">Comments</th>
                    <th className="py-2.5 px-3 font-medium text-right">Clicks</th>
                    <th className="py-2.5 px-4 font-medium text-right">Leads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {countryBreakdown.map((row) => (
                    <tr key={row.country} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 text-slate-900 font-medium">
                        {row.name} <span className="text-xs text-slate-400 font-mono">{row.country}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {row.comments}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {row.clicks}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                        {row.leads}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Recent Comment Dispatch Log</h2>
              <p className="text-xs text-slate-500 mt-0.5">Live API execution outcomes from Meta Graph &amp; X</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('campaigns')}
              className="text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
            >
              Manage Campaigns
            </button>
          </div>

          {recentLogs.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-900">No comments dispatched yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Start a campaign or trigger a manual comment dispatch to view live platform responses here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentLogs.map((log) => (
                <div key={log.id} className="px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-xs text-slate-500 flex items-center gap-2 min-w-0">
                      <span className="font-medium text-slate-900 capitalize">{log.platform}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{log.country}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{log.campaign_name || 'Campaign'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-xs font-medium">
                      {log.delivery_status === 'published' ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
                          <span className="text-[#16A34A]">Published</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-[#DC2626]" />
                          <span className="text-[#DC2626]">Failed</span>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-800 line-clamp-2">{log.comment_text}</p>
                  {log.error_message && (
                    <p className="mt-1 text-xs text-[#DC2626] font-mono">{log.error_message}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                    Target {log.target_post_id} · {new Date(log.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
