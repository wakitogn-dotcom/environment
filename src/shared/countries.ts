export interface CountryOption {
  code: string;
  name: string;
  region: string;
}

export const TARGET_COUNTRIES: CountryOption[] = [
  { code: 'US', name: 'United States', region: 'North America' },
  { code: 'GB', name: 'United Kingdom', region: 'Europe' },
  { code: 'CA', name: 'Canada', region: 'North America' },
  { code: 'AU', name: 'Australia', region: 'Oceania' },
  { code: 'BD', name: 'Bangladesh', region: 'South Asia' },
  { code: 'IN', name: 'India', region: 'South Asia' },
  { code: 'AE', name: 'United Arab Emirates', region: 'Middle East' },
  { code: 'SA', name: 'Saudi Arabia', region: 'Middle East' },
  { code: 'DE', name: 'Germany', region: 'Europe' },
  { code: 'FR', name: 'France', region: 'Europe' },
  { code: 'SG', name: 'Singapore', region: 'Southeast Asia' },
  { code: 'MY', name: 'Malaysia', region: 'Southeast Asia' },
  { code: 'ID', name: 'Indonesia', region: 'Southeast Asia' },
  { code: 'PH', name: 'Philippines', region: 'Southeast Asia' },
  { code: 'BR', name: 'Brazil', region: 'South America' },
  { code: 'NG', name: 'Nigeria', region: 'Africa' },
  { code: 'ZA', name: 'South Africa', region: 'Africa' },
  { code: 'JP', name: 'Japan', region: 'East Asia' },
];

export type SocialPlatform = 'facebook' | 'instagram' | 'twitter';

export function getCountryName(code: string): string {
  const found = TARGET_COUNTRIES.find((c) => c.code === code.toUpperCase());
  return found ? found.name : code;
}

/**
 * Resolves nested/flat spintax like `{Hey|Hi|Hello}` and dynamic campaign variables
 * such as `{country}`, `{offer_link}`, `{offer_name}`, `{brand}`, `{platform}`.
 */
export function resolveCommentTemplate(
  template: string,
  vars: {
    country?: string;
    offerLink?: string;
    offerName?: string;
    brand?: string;
    platform?: string;
  }
): string {
  let output = template;

  // Replace known tokens first so spintax inside braces doesn't collide
  const tokenMap: Record<string, string> = {
    '{country}': vars.country || 'your region',
    '{offer_link}': vars.offerLink || '',
    '{offer_name}': vars.offerName || '',
    '{brand}': vars.brand || '',
    '{platform}': vars.platform || '',
  };

  for (const [token, value] of Object.entries(tokenMap)) {
    output = output.split(token).join(value);
  }

  // Resolve spintax blocks `{optionA|optionB|optionC}`
  const spintaxRegex = /\{([^{}]+)\}/g;
  let guard = 0;
  while (spintaxRegex.test(output) && guard < 10) {
    output = output.replace(spintaxRegex, (_match, choices: string) => {
      if (!choices.includes('|')) {
        return choices;
      }
      const parts = choices.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return '';
      return parts[Math.floor(Math.random() * parts.length)];
    });
    guard += 1;
  }

  return output.replace(/\s{2,}/g, ' ').trim();
}

export const COUNTRY_LOCATION_HINTS: Record<string, { searchTerms: string[]; signals: RegExp[] }> = {
  US: {
    searchTerms: ['USA', 'United States', 'America'],
    signals: [/\b(usa|u\.s\.a|united states|america|california|texas|florida|new york|nyc|los angeles|chicago|miami|atlanta)\b/i],
  },
  GB: {
    searchTerms: ['UK', 'United Kingdom', 'London'],
    signals: [/\b(uk|u\.k|united kingdom|britain|england|london|manchester|birmingham|scotland|glasgow)\b/i, /£/],
  },
  CA: {
    searchTerms: ['Canada', 'Toronto'],
    signals: [/\b(canada|toronto|vancouver|montreal|calgary|ontario|alberta|ottawa)\b/i],
  },
  AU: {
    searchTerms: ['Australia', 'Sydney'],
    signals: [/\b(australia|sydney|melbourne|brisbane|perth|adelaide)\b/i],
  },
  BD: {
    searchTerms: ['Bangladesh', 'Dhaka'],
    signals: [/\b(bangladesh|dhaka|chittagong|chattogram|sylhet|rajshahi|khulna|bd)\b/i, /৳/, /[\u0980-\u09FF]/],
  },
  IN: {
    searchTerms: ['India', 'Mumbai'],
    signals: [/\b(india|mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune)\b/i, /₹/],
  },
  AE: {
    searchTerms: ['Dubai', 'UAE'],
    signals: [/\b(uae|dubai|abu dhabi|emirates|sharjah)\b/i],
  },
  SA: {
    searchTerms: ['Saudi Arabia', 'Riyadh'],
    signals: [/\b(saudi|riyadh|jeddah|ksa)\b/i],
  },
  DE: {
    searchTerms: ['Germany', 'Berlin'],
    signals: [/\b(germany|deutschland|berlin|munich|hamburg|frankfurt)\b/i],
  },
  FR: {
    searchTerms: ['France', 'Paris'],
    signals: [/\b(france|paris|lyon|marseille)\b/i],
  },
  SG: {
    searchTerms: ['Singapore'],
    signals: [/\b(singapore|sg)\b/i],
  },
  MY: {
    searchTerms: ['Malaysia', 'Kuala Lumpur'],
    signals: [/\b(malaysia|kuala lumpur|penang|johor)\b/i],
  },
  ID: {
    searchTerms: ['Indonesia', 'Jakarta'],
    signals: [/\b(indonesia|jakarta|bali|surabaya)\b/i],
  },
  PH: {
    searchTerms: ['Philippines', 'Manila'],
    signals: [/\b(philippines|manila|cebu|davao)\b/i],
  },
  BR: {
    searchTerms: ['Brazil', 'Sao Paulo'],
    signals: [/\b(brazil|brasil|sao paulo|rio de janeiro)\b/i],
  },
  NG: {
    searchTerms: ['Nigeria', 'Lagos'],
    signals: [/\b(nigeria|lagos|abuja)\b/i],
  },
  ZA: {
    searchTerms: ['South Africa', 'Johannesburg'],
    signals: [/\b(south africa|johannesburg|cape town|durban)\b/i],
  },
  JP: {
    searchTerms: ['Japan', 'Tokyo'],
    signals: [/\b(japan|tokyo|osaka|kyoto)\b/i],
  },
};

export function detectCountryFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Direct ISO code match (e.g. "US", "GB", "BD")
  if (/^[A-Z]{2}$/.test(trimmed)) {
    const known = TARGET_COUNTRIES.find((c) => c.code === trimmed);
    if (known) return known.code;
  }

  for (const [code, info] of Object.entries(COUNTRY_LOCATION_HINTS)) {
    if (info.signals.some((rx) => rx.test(trimmed))) {
      return code;
    }
  }
  return null;
}

