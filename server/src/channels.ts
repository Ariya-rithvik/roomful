// Content for the living-room channels, from sources we are allowed to show:
//  - Kids channel: the royalty-free "Scrap TV" catalogue published by Amazon developer evangelists
//    (github.com/chris-trag/scrap-tv-feed, MIT-0), filtered to TV-G shows without horror/thriller.
//  - Family channel: the rest of the same catalogue that suits a mixed-age room: TV-G and TV-PG
//    shows that are not already on the kids channel, still without horror/thriller.
//  - News: headlines from a public RSS feed (default BBC News world), shown with the source name.
// All are fetched by the family server and cached, so the TV only talks to the family server.

export interface ChannelItem { id: string; title: string; description: string; video: string; poster: string; durationSec: number | null }
export interface NewsItem { title: string; link: string }

export const CATALOG_URL = 'https://raw.githubusercontent.com/chris-trag/scrap-tv-feed/main/catalog-fullUrls.json';
export const DEFAULT_NEWS_RSS = 'https://feeds.bbci.co.uk/news/world/rss.xml';
const NOT_FOR_KIDS = ['Horror', 'Thriller'];

interface CatalogEntry {
  id?: string; title?: string; description?: string; content_rating?: string; genres?: string[]; duration_sec?: number;
  images?: { poster_16x9?: string }; sources?: { type?: string; url?: string }[];
}

/** What the server's channel endpoints read from (liveSources implements it; tests pass fakes). */
export interface ChannelSources {
  kids: () => Promise<ChannelItem[] | null>;
  /** Optional so a caller that only has kids + news keeps working (the endpoint then answers 503). */
  family?: () => Promise<ChannelItem[] | null>;
  news: () => Promise<{ source: string; items: NewsItem[] } | null>;
}

const catalogItems = (catalog: unknown): CatalogEntry[] | null => {
  const items = (catalog as { items?: CatalogEntry[] })?.items;
  return Array.isArray(items) ? items : null;
};

/** A playable channel item, or null when the entry has no id, title or https mp4. */
function toItem(it: CatalogEntry): ChannelItem | null {
  const video = it.sources?.find((s) => s.type === 'mp4' && typeof s.url === 'string' && /^https:\/\//.test(s.url))?.url;
  if (!it.id || !it.title || !video) return null;
  return {
    id: it.id, title: it.title, description: (it.description ?? '').slice(0, 300), video,
    poster: it.images?.poster_16x9 ?? '', durationSec: typeof it.duration_sec === 'number' ? it.duration_sec : null,
  };
}

// Genres are not enough: a "reality" show about zombie make-up is still not for a living room with kids.
const SCARY_WORDS = /\b(zombies?|gore|gory|horror|bloody?|blood|murders?|killers?|corpses?|demons?|haunted|creepy|terrifying)\b/i;
const scary = (it: CatalogEntry) =>
  (it.genres ?? []).some((g) => NOT_FOR_KIDS.includes(g)) || SCARY_WORDS.test(`${it.title ?? ''} ${it.description ?? ''}`);

/** Kid-safe items from the catalogue JSON (pure; tested). */
export function kidsLineup(catalog: unknown): ChannelItem[] {
  const items = catalogItems(catalog);
  if (!items) return [];
  const out: ChannelItem[] = [];
  for (const it of items) {
    if (it.content_rating !== 'TV-G' || scary(it)) continue;
    const item = toItem(it);
    if (item) out.push(item);
  }
  // Shows tagged Kids first, then the rest in catalogue order.
  return out.sort((a, b) => Number(isKids(items, b.id)) - Number(isKids(items, a.id)));
}
const isKids = (items: CatalogEntry[], id: string) => !!items.find((i) => i.id === id)?.genres?.includes('Kids');

/**
 * A second channel for the whole family from the same catalogue (pure; tested): TV-G and TV-PG
 * shows that are not on the kids channel, without horror/thriller, in catalogue order.
 * TV-14 and TV-MA are never included.
 */
export function familyLineup(catalog: unknown): ChannelItem[] {
  const items = catalogItems(catalog);
  if (!items) return [];
  const onKids = new Set(kidsLineup(catalog).map((i) => i.id));
  const out: ChannelItem[] = [];
  for (const it of items) {
    if ((it.content_rating !== 'TV-G' && it.content_rating !== 'TV-PG') || scary(it)) continue;
    const item = toItem(it);
    if (item && !onKids.has(item.id) && !out.some((o) => o.id === item.id)) out.push(item);
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .trim();

/** Headlines from an RSS 2.0 document (pure; tested). */
export function parseRss(xml: string, max = 12): { source: string; items: NewsItem[] } {
  const channelTitle = /<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/.exec(xml)?.[1];
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(m[0])?.[1];
    const link = /<link>([\s\S]*?)<\/link>/.exec(m[0])?.[1];
    if (!title) continue;
    items.push({ title: decode(title).slice(0, 200), link: link ? decode(link) : '' });
    if (items.length >= max) break;
  }
  return { source: channelTitle ? decode(channelTitle).slice(0, 80) : 'News', items };
}

/** Fetch-and-cache wrapper: refreshes at most every ttlMs; keeps the last good value if a refresh fails. */
export function cached<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let value: T | null = null;
  let at = 0;
  let inflight: Promise<T> | null = null;
  return async (): Promise<T | null> => {
    if (value !== null && now() - at < ttlMs) return value;
    inflight ??= load()
      .then((v) => {
        value = v;
        at = now();
        return v;
      })
      .finally(() => {
        inflight = null;
      });
    try {
      return await inflight;
    } catch {
      return value;
    }
  };
}

export function liveSources(newsUrl = process.env.NEWS_RSS || DEFAULT_NEWS_RSS) {
  const get = async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Roomcaption/0.1 (family TV)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  };
  // One catalogue download feeds both video channels.
  const catalog = cached(async (): Promise<unknown> => JSON.parse(await get(CATALOG_URL)), 6 * 60 * 60_000);
  const lineup = (pick: (c: unknown) => ChannelItem[]) => async () => {
    const c = await catalog();
    return c === null ? null : pick(c);
  };
  return {
    kids: lineup(kidsLineup),
    family: lineup(familyLineup),
    news: cached(async () => parseRss(await get(newsUrl)), 10 * 60_000),
  } satisfies ChannelSources;
}
