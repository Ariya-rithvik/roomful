// The TV as a watchful family member: real disaster alerts from GDACS (Global Disaster Alert and
// Coordination System, EU Joint Research Centre + UN; CC BY 4.0, credit "GDACS"). The server polls
// the public feed and, when an event is near the family's home (or in a watched country at Orange/Red
// level), the TV interrupts whatever is on screen and every phone alarms. It never invents alerts:
// a test alert exists only when the server is started with ALERT_TEST=1, and it is labelled TEST.

export const GDACS_RSS = 'https://www.gdacs.org/xml/rss.xml';

export const EVENT_KINDS: Record<string, string> = {
  EQ: 'Earthquake', FL: 'Flood', TC: 'Cyclone', VO: 'Volcano', DR: 'Drought', WF: 'Forest fire', TS: 'Tsunami',
};

export interface GdacsEvent {
  id: string; kind: string; level: 'Green' | 'Orange' | 'Red'; title: string; country: string; iso3: string;
  lat: number | null; lon: number | null; bbox: [number, number, number, number] | null; url: string; from: string;
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1]) : '';
};
const decode = (s: string) =>
  s.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

/** Events from the GDACS RSS feed (pure; tested). */
export function parseGdacs(xml: string): GdacsEvent[] {
  const out: GdacsEvent[] = [];
  for (const m of xml.matchAll(/<item>[\s\S]*?<\/item>/g)) {
    const it = m[0];
    const level = tag(it, 'gdacs:alertlevel');
    if (level !== 'Green' && level !== 'Orange' && level !== 'Red') continue;
    const id = tag(it, 'guid');
    if (!id) continue;
    const lat = parseFloat(tag(it, 'geo:lat'));
    const lon = parseFloat(tag(it, 'geo:long'));
    const bb = tag(it, 'gdacs:bbox').split(/\s+/).map(Number);
    out.push({
      id, kind: tag(it, 'gdacs:eventtype'), level, title: tag(it, 'title').replace(/\s+/g, ' ').slice(0, 240),
      country: tag(it, 'gdacs:country').slice(0, 120), iso3: tag(it, 'gdacs:iso3'),
      lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
      bbox: bb.length === 4 && bb.every(Number.isFinite) ? (bb as [number, number, number, number]) : null,
      url: tag(it, 'link'), from: tag(it, 'gdacs:fromdate'),
    });
  }
  return out;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(a)));
}

export interface WatchConfig { homeLat: number | null; homeLon: number | null; radiusKm: number; countries: string[] }

/**
 * Does this event concern the family? Yes when the home lies inside the event's affected box, or the
 * event is within radiusKm of home, or it is Orange/Red in a watched country. Green events far away
 * are ignored so the TV does not cry wolf.
 */
export function concerns(e: GdacsEvent, w: WatchConfig): { yes: boolean; distanceKm: number | null; why: string } {
  const hasHome = w.homeLat !== null && w.homeLon !== null;
  const d = hasHome && e.lat !== null && e.lon !== null ? distanceKm(w.homeLat!, w.homeLon!, e.lat, e.lon) : null;
  // Slow-onset droughts are not a "drop everything" moment: never take over the TV for them.
  if (e.kind === 'DR') return { yes: false, distanceKm: d, why: '' };
  // GDACS affected boxes can span whole regions; inside one only counts for Orange/Red events.
  if (hasHome && e.bbox && e.level !== 'Green') {
    const [lonMin, lonMax, latMin, latMax] = e.bbox;
    if (w.homeLon! >= lonMin && w.homeLon! <= lonMax && w.homeLat! >= latMin && w.homeLat! <= latMax) {
      return { yes: true, distanceKm: d, why: 'your home is inside the affected area' };
    }
  }
  if (d !== null && d <= w.radiusKm) return { yes: true, distanceKm: d, why: `${d} km from your home` };
  if (e.level !== 'Green' && w.countries.includes(e.iso3)) return { yes: true, distanceKm: d, why: `${e.level} alert in ${e.country}` };
  return { yes: false, distanceKm: d, why: '' };
}
