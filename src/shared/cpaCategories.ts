export const CPA_OFFER_CATEGORIES = [
  'Sweepstakes & Giveaways',
  'Gift Cards & Rewards',
  'App Install (CPI)',
  'Finance & Crypto',
  'Health & Beauty (Nutra)',
  'Dating & Social',
  'E-commerce & Deals',
  'Jobs & Education',
  'Gaming & Entertainment',
  'Email / Zip Submit',
  'Software & SaaS Trial',
  'Other CPA Offer',
] as const;

export type CpaOfferCategory = (typeof CPA_OFFER_CATEGORIES)[number];
