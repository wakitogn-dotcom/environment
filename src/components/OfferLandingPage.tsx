import { useEffect, useState } from 'react';
import { CheckCircle2, ArrowRight, ShieldCheck } from 'lucide-react';
import { TARGET_COUNTRIES } from '../shared/countries';

interface PublicOfferData {
  id: string;
  name: string;
  slug: string;
  mode: string;
  destination_url: string;
  headline: string;
  subheadline: string;
  cta_label: string;
  benefit_points: string[];
  target_countries: string[];
  brand_name: string;
}

interface OfferLandingPageProps {
  slug: string;
}

export function OfferLandingPage({ slug }: OfferLandingPageProps) {
  const params = new URLSearchParams(window.location.search);
  const campaignId = params.get('c') || '';
  const sourcePlatform = params.get('p') || 'direct';
  const initialGeo = (params.get('geo') || 'US').toUpperCase();

  const [offer, setOffer] = useState<PublicOfferData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [heroImgError, setHeroImgError] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState(
    TARGET_COUNTRIES.some((c) => c.code === initialGeo) ? initialGeo : 'US'
  );
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedDestUrl, setSubmittedDestUrl] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/public/offers/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!res.ok) {
          if (active) setNotFound(true);
          return;
        }
        const data = (await res.json()) as { offer: PublicOfferData };
        if (active) setOffer(data.offer);
      })
      .catch(() => {
        if (active) setNotFound(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer_slug: slug,
          campaign_id: campaignId || undefined,
          source_platform: sourcePlatform,
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          country,
          notes: notes.trim(),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; destinationUrl?: string | null; error?: string };
      if (!res.ok) {
        setSubmitError(data.error || 'Please check your information and try again.');
      } else {
        setSubmitted(true);
        setSubmittedDestUrl(data.destinationUrl || null);
      }
    } catch {
      setSubmitError('Network error submitting request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-xl h-72 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (notFound || !offer) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-lg p-8 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-slate-900">Offer Unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">
            This promotional link has expired or been paused by the campaign owner.
          </p>
          <a
            href="/"
            className="mt-5 inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg"
          >
            Return to Workspace
          </a>
        </div>
      </div>
    );
  }

  const brandDisplay = offer.brand_name || offer.name;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display">
            {brandDisplay}
          </span>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#offer-overview" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Overview
            </a>
            <a href="#offer-benefits" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              What You Get
            </a>
            <a href="#claim-form" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Claim Offer
            </a>
          </nav>
          <a
            href="#claim-form"
            className="px-4 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {offer.cta_label}
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 lg:py-16 space-y-12">
        {/* Hero Split */}
        <section id="offer-overview" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <p className="text-xs font-medium text-slate-500">
                {offer.name} · Regional Offer ({country})
              </p>
              <h1
                className="font-display font-bold tracking-tight text-slate-900 leading-[1.12]"
                style={{ fontSize: 'clamp(2rem, 3.6vw, 3.25rem)', textWrap: 'balance' }}
              >
                {offer.headline}
              </h1>
              {offer.subheadline && (
                <p className="text-base text-slate-600 leading-relaxed max-w-2xl">{offer.subheadline}</p>
              )}
            </div>

            {/* 16:9 Editorial Visual with Zero-Broken-Image Fallback */}
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100 aspect-video relative">
              {!heroImgError ? (
                <img
                  src="/src/assets/images/offer_hero_banner_1795719019727.jpg"
                  alt={`${brandDisplay} workspace showcase`}
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-slate-100 via-slate-200 to-slate-100 flex items-center justify-center p-6">
                  <span className="text-sm font-semibold text-slate-700">{brandDisplay}</span>
                </div>
              )}
            </div>

            {offer.benefit_points.length > 0 && (
              <div id="offer-benefits" className="pt-2 space-y-2.5">
                <h2 className="text-sm font-semibold text-slate-900">Included with this offer</h2>
                <ul className="space-y-2">
                  {offer.benefit_points.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <CheckCircle2 className="w-4 h-4 text-[#16A34A] mt-0.5 shrink-0" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right Column: Validated Lead Capture Form */}
          <div id="claim-form" className="lg:col-span-5">
            <div className="bg-white border border-slate-200 rounded-lg p-6 lg:p-8 h-full flex flex-col justify-between">
              {submitted ? (
                <div className="my-auto py-8 text-center space-y-4">
                  <CheckCircle2 className="w-10 h-10 text-[#16A34A] mx-auto" />
                  <h2 className="text-xl font-semibold text-slate-900">Request Confirmed</h2>
                  <p className="text-sm text-slate-600">
                    Thank you, {fullName}. Your details for <span className="font-medium">{offer.name}</span> have been recorded.
                  </p>
                  {submittedDestUrl && (
                    <a
                      href={submittedDestUrl}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg transition-colors"
                    >
                      Continue to Offer
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{offer.cta_label}</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Complete the form below to receive instant access.
                    </p>
                  </div>

                  {submitError && (
                    <div className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900">
                      {submitError}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your full name"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Phone / WhatsApp</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+1 555 0192"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Country</label>
                      <select
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
                      >
                        {TARGET_COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Notes (Optional)</label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Share what you are looking for..."
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1D4ED8]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg transition-colors disabled:opacity-60"
                  >
                    {submitting ? 'Submitting...' : offer.cta_label}
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500 pt-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                    Direct response · No third-party sharing
                  </p>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>{brandDisplay}</span>
          <span>Promoted Offer · {offer.slug}</span>
        </div>
      </footer>
    </div>
  );
}
