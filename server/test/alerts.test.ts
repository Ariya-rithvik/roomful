import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concerns, distanceKm, parseGdacs } from '../src/alerts';

const item = (o: { id: string; level: string; kind: string; iso3: string; lat: number; lon: number; bbox?: string; country?: string }) => `<item>
<title>${o.level} ${o.kind} test &amp; title</title><link>https://www.gdacs.org/report.aspx?eventtype=${o.kind}&amp;eventid=1</link>
<guid isPermaLink="false">${o.id}</guid><geo:Point><geo:lat>${o.lat}</geo:lat><geo:long>${o.lon}</geo:long></geo:Point>
<gdacs:bbox>${o.bbox ?? `${o.lon - 1} ${o.lon + 1} ${o.lat - 1} ${o.lat + 1}`}</gdacs:bbox><gdacs:eventtype>${o.kind}</gdacs:eventtype>
<gdacs:alertlevel>${o.level}</gdacs:alertlevel><gdacs:iso3>${o.iso3}</gdacs:iso3><gdacs:country>${o.country ?? o.iso3}</gdacs:country>
<gdacs:fromdate>Sat, 17 Oct 2026 05:06:57 GMT</gdacs:fromdate></item>`;

const feed = `<rss><channel><title>GDACS</title>
${item({ id: 'FL1', level: 'Orange', kind: 'FL', iso3: 'NPL', lat: 27.7, lon: 85.3, country: 'Nepal' })}
${item({ id: 'EQ2', level: 'Green', kind: 'EQ', iso3: 'PAK', lat: 28.0, lon: 66.2 })}
${item({ id: 'TC3', level: 'Red', kind: 'TC', iso3: 'IND', lat: 15.0, lon: 88.0, bbox: '70 95 5 25' })}
<item><title>no level</title><guid>X</guid></item></channel></rss>`;

test('parses GDACS items: level, kind, country, point, bbox, link', () => {
  const ev = parseGdacs(feed);
  assert.deepEqual(ev.map((e) => e.id), ['FL1', 'EQ2', 'TC3']);
  assert.equal(ev[0].kind, 'FL');
  assert.equal(ev[0].level, 'Orange');
  assert.equal(ev[0].country, 'Nepal');
  assert.equal(ev[0].title, 'Orange FL test & title');
  assert.equal(ev[0].url, 'https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1');
  assert.deepEqual([ev[0].lat, ev[0].lon], [27.7, 85.3]);
  assert.deepEqual(ev[2].bbox, [70, 95, 5, 25]);
  assert.deepEqual(parseGdacs('<html/>'), []);
});

test('distance is roughly right (Delhi to Kathmandu ~ 800 km)', () => {
  const d = distanceKm(28.61, 77.21, 27.7, 85.3);
  assert.ok(d > 750 && d < 850, String(d));
});

test('which events concern the family', () => {
  const [flood, quake, cyclone] = parseGdacs(feed);
  const kathmandu = { homeLat: 27.71, homeLon: 85.32, radiusKm: 300, countries: ['NPL'] };
  assert.equal(concerns(flood, kathmandu).yes, true, 'home inside the flood area');
  assert.equal(concerns(quake, kathmandu).yes, false, 'a distant green quake is ignored');
  const chennai = { homeLat: 13.08, homeLon: 80.27, radiusKm: 300, countries: ['IND'] };
  const c = concerns(cyclone, chennai);
  assert.deepEqual([c.yes, c.why], [true, 'your home is inside the affected area']);
  const noHome = { homeLat: null, homeLon: null, radiusKm: 300, countries: ['NPL'] };
  assert.equal(concerns(flood, noHome).yes, true, 'orange in a watched country');
  assert.equal(concerns(quake, { ...noHome, countries: ['PAK'] }).yes, false, 'green in a watched country but far/unknown: not alarmed');
  // Real case seen on 2026-10-18: "Drought is on going in Southern India" (Green, huge box covering Chennai).
  const drought = { ...flood, id: 'DR1', kind: 'DR', level: 'Green' as const, iso3: 'IND', lat: 12, lon: 78, bbox: [70, 90, 5, 20] as [number, number, number, number] };
  assert.equal(concerns(drought, chennai).yes, false, 'slow-onset drought never takes over the TV');
  const greenBox = { ...drought, id: 'FL9', kind: 'FL', lat: 20, lon: 75 };
  assert.equal(concerns(greenBox, chennai).yes, false, 'a green event whose huge box covers home, but far away, does not alarm');
});
