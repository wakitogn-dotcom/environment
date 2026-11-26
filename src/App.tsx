import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  Target,
  Share2,
  Plus,
} from 'lucide-react';
import { OverviewView } from './components/OverviewView';
import { CampaignsView } from './components/CampaignsView';
import { CommentStudioView } from './components/CommentStudioView';
import { OffersLeadsView } from './components/OffersLeadsView';
import { AccountsView } from './components/AccountsView';
import { OfferLandingPage } from './components/OfferLandingPage';
import type {
  AnalyticsOverview,
  Campaign,
  CommentTemplate,
  Lead,
  OAuthStatus,
  Offer,
  SocialAccount,
} from './types';

type TabKey = 'overview' | 'campaigns' | 'comments' | 'offers' | 'accounts';

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { key: 'comments', label: 'Comment Studio', icon: MessageSquareText },
  { key: 'offers', label: 'Offers & Leads', icon: Target },
  { key: 'accounts', label: 'Social Accounts', icon: Share2 },
];

export default function App() {
  const pathname = window.location.pathname;
  if (pathname.startsWith('/r/')) {
    const slug = pathname.replace(/^\/r\//, '').split('/')[0];
    return <OfferLandingPage slug={decodeURIComponent(slug)} />;
  }

  return <DashboardWorkspace />;
}

function DashboardWorkspace() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [avatarError, setAvatarError] = useState(false);

  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [comments, setComments] = useState<CommentTemplate[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);

  const loadAll = useCallback(async () => {
    try {
      const [ovRes, accRes, oauthRes, comRes, offRes, campRes, leadRes] = await Promise.all([
        fetch('/api/analytics/overview'),
        fetch('/api/accounts'),
        fetch('/api/oauth/status'),
        fetch('/api/comments'),
        fetch('/api/offers'),
        fetch('/api/campaigns'),
        fetch('/api/leads'),
      ]);

      if (ovRes.ok) setAnalytics(await ovRes.json());
      if (accRes.ok) {
        const d = (await accRes.json()) as { accounts: SocialAccount[] };
        setAccounts(d.accounts || []);
      }
      if (oauthRes.ok) setOauthStatus(await oauthRes.json());
      if (comRes.ok) {
        const d = (await comRes.json()) as { comments: CommentTemplate[] };
        setComments(d.comments || []);
      }
      if (offRes.ok) {
        const d = (await offRes.json()) as { offers: Offer[] };
        setOffers(d.offers || []);
      }
      if (campRes.ok) {
        const d = (await campRes.json()) as { campaigns: Campaign[] };
        setCampaigns(d.campaigns || []);
      }
      if (leadRes.ok) {
        const d = (await leadRes.json()) as { leads: Lead[] };
        setLeads(d.leads || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 20_000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const currentNav = NAV_ITEMS.find((n) => n.key === activeTab)!;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col lg:flex-row">
      {/* Sidebar Navigation */}
      <aside className="lg:w-64 lg:shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col justify-between">
        <div>
          <div className="h-16 px-6 flex items-center border-b border-slate-200">
            <span className="text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0">
              ReachPulse
            </span>
          </div>

          <nav aria-label="Workspace navigation" className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-[#1D4ED8]/10 text-[#1D4ED8]'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:flex items-center gap-3 px-5 py-4 border-t border-slate-200">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0 flex items-center justify-center">
            {!avatarError ? (
              <img
                src="/src/assets/images/operator_avatar_1795719019123.jpg"
                alt="Marketing operator"
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-xs font-semibold text-slate-700">RP</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">Growth Console</p>
            <p className="text-xs text-slate-500 truncate tabular-nums">
              {accounts.length} social channel(s)
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 lg:px-8 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-400">Workspace</span>
            <span className="text-slate-300">/</span>
            <h1 className="font-semibold text-slate-900 truncate">{currentNav.label}</h1>
          </div>

          <button
            type="button"
            onClick={() =>
              setActiveTab(activeTab === 'campaigns' ? 'comments' : activeTab === 'accounts' ? 'campaigns' : 'campaigns')
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            {activeTab === 'campaigns' ? 'Add Comments' : 'New Campaign'}
          </button>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {activeTab === 'overview' && (
            <OverviewView analytics={analytics} loading={loading} onNavigate={setActiveTab} />
          )}
          {activeTab === 'campaigns' && (
            <CampaignsView campaigns={campaigns} accounts={accounts} offers={offers} onRefresh={loadAll} />
          )}
          {activeTab === 'comments' && (
            <CommentStudioView comments={comments} offers={offers} onRefresh={loadAll} />
          )}
          {activeTab === 'offers' && (
            <OffersLeadsView offers={offers} leads={leads} onRefresh={loadAll} />
          )}
          {activeTab === 'accounts' && (
            <AccountsView accounts={accounts} oauthStatus={oauthStatus} onRefresh={loadAll} />
          )}
        </main>
      </div>
    </div>
  );
}
