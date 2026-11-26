import { GoogleGenAI, Type } from '@google/genai';

export interface OfferContext {
  id: string;
  name: string;
  cpa_category?: string;
  headline: string;
  subheadline: string;
  cta_label: string;
  benefit_points: string[];
  brand_name: string;
}

export interface GeneratedCommentItem {
  category: string;
  content: string;
}

export function isGeminiConfigured(): boolean {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateOfferComments(params: {
  offer: OfferContext;
  count: number;
  language: string;
  platforms: string[];
  tone?: string;
}): Promise<GeneratedCommentItem[]> {
  const ai = getAiClient();
  const safeCount = Math.max(5, Math.min(50, params.count || 15));
  const tone = params.tone || 'Helpful, Credible & Human Viewer Tone';
  const benefitsText = params.offer.benefit_points.length
    ? params.offer.benefit_points.join('; ')
    : 'Verified regional availability';

  const prompt = `Generate ${safeCount} unique, highly credible, human-sounding social media Reels video comment templates in ${params.language} for this offer:
- Offer Name: ${params.offer.name}
- CPA Category: ${params.offer.cpa_category || 'General Offer'}
- Brand: ${params.offer.brand_name || params.offer.name}
- Headline: ${params.offer.headline}
- Subheadline: ${params.offer.subheadline || 'N/A'}
- Key Benefits: ${benefitsText}
- Call To Action: ${params.offer.cta_label}
- Target Platforms: ${params.platforms.join(', ')}
- Tone / Style: ${tone}

Strict Trust & Human-Like Rules:
1. Write like a real, everyday viewer sharing something genuinely helpful in the comment section—NEVER like a bot or pushy ad.
2. NEVER use ALL-CAPS hype words ("FREE MONEY!!", "ACT NOW!!", "CLICK HERE FAST"), multiple exclamation marks, or spammy emoji chains.
3. Build natural trust so viewers feel comfortable opening the link (e.g., sharing personal verification, noting regional eligibility in {country}, or politely helping people who were asking about it).
4. Include the exact placeholder {offer_link} in every comment so the tracking URL is placed naturally.
5. Include {country} naturally in at least half of the comments (e.g., "checked if it's active in {country}").
6. Light conversational spintax like {Honest question|Quick heads up} or {worked fine|still live} is great.
7. Keep every comment concise (90–210 characters) so it reads naturally on Facebook Reels, Instagram Reels, and X.
8. Assign each item a category from: "Offer Hook", "Reels Viral", "Question CTA", "Social Proof".`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are a genuine social media community member and conversion copywriter who writes grounded, trustworthy, zero-spam Reels comments that real viewers believe and click.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              description: 'One of: Offer Hook, Reels Viral, Question CTA, Social Proof',
            },
            content: {
              type: Type.STRING,
              description: 'The human-like Reels comment template containing {offer_link}',
            },
          },
          required: ['category', 'content'],
        },
      },
    },
  });

  const rawText = (response.text ?? '[]').trim();
  const parsed = JSON.parse(rawText) as Array<{ category?: string; content?: string }>;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Model returned no comment templates.');
  }

  return parsed
    .filter((item) => typeof item.content === 'string' && item.content.trim().length > 0)
    .map((item) => {
      let text = item.content!.trim();
      if (!text.includes('{offer_link}')) {
        text = `${text} {offer_link}`;
      }
      return {
        category: item.category?.trim() || 'Offer Hook',
        content: text.slice(0, 280),
      };
    });
}

export async function generateHumanVideoReply(params: {
  videoTitle: string;
  platform: string;
  countryName: string;
  offer: OfferContext | null;
  offerLink: string;
  language?: string;
}): Promise<string> {
  const ai = getAiClient();
  const lang = params.language || 'English';

  const offerPart = params.offer
    ? `Offer Name: ${params.offer.name} (${params.offer.cpa_category || 'Offer'})
Offer Headline: ${params.offer.headline}
Exact Link to include once naturally: ${params.offerLink}`
    : 'No link required; write a genuine friendly comment reacting to the video.';

  const prompt = `Write 1 single natural, believable, human-like comment in ${lang} replying to this specific ${params.platform} Reels/video:
- Video Caption / Topic: "${params.videoTitle.slice(0, 180)}"
- Viewer Target Country: ${params.countryName}
- ${offerPart}

Rules:
1. First, briefly react or relate naturally to the actual video topic above so anyone reading sees you actually watched the video.
2. Smoothly and honestly transition to mentioning the offer for people in ${params.countryName}, including the exact URL ${params.offerLink} (if provided) without changing a single character of the URL.
3. Sound like a real person leaving a helpful comment—no hype, no ALL CAPS, max 1 subtle emoji or none, no spam clichés.
4. Keep the entire comment under 240 characters so it works cleanly on ${params.platform}.
5. Return ONLY the final comment text, with no quotes or extra explanation.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You write authentic, context-aware human replies on social videos that earn reader trust.',
    },
  });

  let text = (response.text ?? '').trim().replace(/^["']|["']$/g, '');
  if (!text) {
    throw new Error('Model returned an empty contextual reply.');
  }
  if (params.offerLink && !text.includes(params.offerLink)) {
    text = `${text} ${params.offerLink}`.trim();
  }
  return text.slice(0, 280);
}
