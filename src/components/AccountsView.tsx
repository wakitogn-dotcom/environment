import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Copy, Check, ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import type { OAuthStatus, SocialAccount } from '../types';

interface AccountsViewProps {
  accounts: SocialAccount[];
  oauthStatus: OAuthStatus | null;
  onRefresh: () => void;
}

export function AccountsView({ accounts, oauthStatus, onRefresh }: AccountsViewProps) {
  const [connectingProvider, setConnectingProvider] = useState<'meta' | 'twitter' | null>(null);
  const [tokenProvider, setTokenProvider] = useState<'meta' | 'twitter' | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSubmitting, setTokenSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setConnectingProvider(null);
        setFeedback({
          type: 'success',
          text:
            event.data.provider === 'meta'
              ? `Connected ${event.data.count || 1} Facebook/Instagram account(s) via Meta OAuth.`
              : 'Connected Twitter / X account via OAuth 2.0.',
        });
        onRefresh();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setConnectingProvider(null);
        setFeedback({
          type: 'error',
          text: event.data.message || 'OAuth authorization failed.',
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onRefresh]);

  const handleOAuthConnect = async (provider: 'meta' | 'twitter') => {
    setFeedback(null);
    setConnectingProvider(provider);
    try {
      const res = await fetch(`/api/oauth/${provider}/url`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setConnectingProvider(null);
        setFeedback({
          type: 'error',
          text: data.error || 'OAuth credentials are not configured yet. Add them in Secrets or use Token Connect below.',
        });
        return;
      }

      const authWindow = window.open(data.url, 'oauth_popup', 'width=640,height=740');
      if (!authWindow) {
        setConnectingProvider(null);
        setFeedback({
          type: 'error',
          text: 'Popup was blocked by your browser. Allow popups for this site and try again.',
        });
      }
    } catch (err) {
      setConnectingProvider(null);
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to start OAuth flow.',
      });
    }
  };

  const handleVerifyToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenProvider || !tokenInput.trim()) return;
    setTokenSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/accounts/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: tokenProvider, accessToken: tokenInput.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; count?: number; error?: string };
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Token verification failed.' });
      } else {
        setFeedback({
          type: 'success',
          text: `Verified against live ${tokenProvider === 'meta' ? 'Meta Graph API' : 'X API v2'} (${data.count || 1} account synced).`,
        });
        setTokenInput('');
        setTokenProvider(null);
        onRefresh();
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Verification request failed.' });
    } finally {
      setTokenSubmitting(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    setFeedback(null);
    const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setFeedback({ type: 'success', text: 'Account disconnected and credentials removed.' });
      onRefresh();
    }
  };

  const handleCopy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <div className="space-y-8">
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
          <span>{feedback.text}</span>
        </div>
      )}

      {/* OAuth Integration Providers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Meta (Facebook + Instagram Reels) */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900">
                Facebook &amp; Instagram Business (Meta)
              </h2>
              <span
                className={`text-xs font-medium ${
                  oauthStatus?.meta.configured ? 'text-[#16A34A]' : 'text-[#D97706]'
                }`}
              >
                {oauthStatus?.meta.configured ? 'OAuth Ready' : 'Secrets Required'}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-slate-600">
              Connects your Facebook Pages, Facebook Reels, and linked Instagram Business accounts for live comment publishing and hashtag discovery.
            </p>

            <div className="mt-4 pt-4 border-t border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>OAuth Redirect Callback URL</span>
                <button
                  type="button"
                  onClick={() => handleCopy('meta-cb', oauthStatus?.meta.callbackUrl || '')}
                  className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline font-medium"
                >
                  {copiedKey === 'meta-cb' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedKey === 'meta-cb' ? 'Copied' : 'Copy URL'}
                </button>
              </div>
              <code className="block w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-800 break-all">
                {oauthStatus?.meta.callbackUrl || 'Loading callback URL...'}
              </code>
              <p className="text-xs text-slate-500">
                Required secrets: <span className="font-mono text-slate-700">META_APP_ID</span>,{' '}
                <span className="font-mono text-slate-700">META_APP_SECRET</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={connectingProvider === 'meta'}
              onClick={() => handleOAuthConnect('meta')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {connectingProvider === 'meta' ? 'Waiting for Meta...' : 'Connect Facebook & Instagram'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTokenProvider(tokenProvider === 'meta' ? null : 'meta');
                setTokenInput('');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Use Graph API Token
            </button>
          </div>
        </section>

        {/* Twitter / X */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900">Twitter / X (OAuth 2.0 PKCE)</h2>
              <span
                className={`text-xs font-medium ${
                  oauthStatus?.twitter.configured ? 'text-[#16A34A]' : 'text-[#D97706]'
                }`}
              >
                {oauthStatus?.twitter.configured ? 'OAuth Ready' : 'Secrets Required'}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-slate-600">
              Authorizes X API v2 with automatic PKCE token refresh so your campaigns can search recent posts and publish targeted replies.
            </p>

            <div className="mt-4 pt-4 border-t border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>OAuth 2.0 Callback URL</span>
                <button
                  type="button"
                  onClick={() => handleCopy('tw-cb', oauthStatus?.twitter.callbackUrl || '')}
                  className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline font-medium"
                >
                  {copiedKey === 'tw-cb' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedKey === 'tw-cb' ? 'Copied' : 'Copy URL'}
                </button>
              </div>
              <code className="block w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-800 break-all">
                {oauthStatus?.twitter.callbackUrl || 'Loading callback URL...'}
              </code>
              <p className="text-xs text-slate-500">
                Required secrets: <span className="font-mono text-slate-700">TWITTER_CLIENT_ID</span>,{' '}
                <span className="font-mono text-slate-700">TWITTER_CLIENT_SECRET</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={connectingProvider === 'twitter'}
              onClick={() => handleOAuthConnect('twitter')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {connectingProvider === 'twitter' ? 'Waiting for X...' : 'Connect Twitter / X'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTokenProvider(tokenProvider === 'twitter' ? null : 'twitter');
                setTokenInput('');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Use X Bearer Token
            </button>
          </div>
        </section>
      </div>

      {/* Direct API Token Verification Form */}
      {tokenProvider && (
        <form onSubmit={handleVerifyToken} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Verify &amp; Connect {tokenProvider === 'meta' ? 'Meta Graph API' : 'X API v2'} Access Token
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Token is verified directly against the live {tokenProvider === 'meta' ? 'Meta Graph API' : 'X API'} and encrypted on the server.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTokenProvider(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              required
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={
                tokenProvider === 'meta'
                  ? 'Paste Meta Graph User or Page Access Token (EAA...)'
                  : 'Paste X OAuth 2.0 User Access Token'
              }
              className="flex-1 px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] font-mono"
            />
            <button
              type="submit"
              disabled={tokenSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {tokenSubmitting ? 'Verifying...' : 'Verify & Connect'}
            </button>
          </div>
        </form>
      )}

      {/* Connected Accounts Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Connected Social Accounts</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Encrypted credentials stored server-side · {accounts.length} active channel(s)
            </p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900">No social accounts connected yet</p>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              Use the OAuth buttons above (after adding your app secrets) or paste a live Meta Graph / X User Access Token to verify and connect your accounts.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-5 font-medium">Account</th>
                  <th className="py-2.5 px-4 font-medium">Platform</th>
                  <th className="py-2.5 px-4 font-medium">External ID</th>
                  <th className="py-2.5 px-4 font-medium">Auth Method</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-5">
                      <div className="font-medium text-slate-900">{acc.account_name}</div>
                      <div className="text-xs text-slate-500 font-mono">@{acc.username}</div>
                    </td>
                    <td className="py-3 px-4 capitalize text-slate-700 font-medium">{acc.platform}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">{acc.external_id}</td>
                    <td className="py-3 px-4 text-xs text-slate-600 uppercase font-mono">{acc.connection_mode}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                          acc.status === 'connected' ? 'text-[#16A34A]' : 'text-[#DC2626]'
                        }`}
                      >
                        {acc.status === 'connected' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5" />
                        )}
                        {acc.status === 'connected' ? 'Connected' : 'Token Expired'}
                      </span>
                    </td>
                    <td className="py-3 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => handleDisconnect(acc.id)}
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#DC2626] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Disconnect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
