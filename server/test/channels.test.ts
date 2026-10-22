import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cached, CATALOG_URL, familyLineup, kidsLineup, liveSources, parseRss, type ChannelSources } from '../src/channels';
import { createApp } from '../src/app';

const item = (id: string, rating: string, genres: string[], url = `https://example.org/${id}.mp4`) => ({
  id, title: id.toUpperCase(), description: 'd', content_rating: rating, genres, duration_sec: 10,
  images: { poster_16x9: `https://example.org/${id}.jpg` }, sources: [{ type: 'mp4', url }],
});

test('kids lineup: TV-G only, no horror or thriller, Kids-tagged first, https only', () => {
  const lineup = kidsLineup({
    items: [
      item('cats', 'TV-G', ['Comedy']),
      item('queue', 'TV-G', ['Thriller', 'Horror']),
      item('mature', 'TV-MA', ['Comedy']),
      item('cereal', 'TV-G', ['Kids', 'Reality']),
      item('insecure', 'TV-G', ['Kids'], 'http://example.org/x.mp4'),
      { id: 'broken' },
    ],
  });
  assert.deepEqual(lineup.map((i) => i.id), ['cereal', 'cats']);
  assert.equal(lineup[0].video, 'https://example.org/cereal.mp4');
  assert.equal(lineup[0].durationSec, 10);
  assert.deepEqual(kidsLineup(null), []);
  assert.deepEqual(kidsLineup({ items: 'x' }), []);
});

test('rss: titles, CDATA, entities, max, channel name', () => {
  const xml = `<?xml version="1.0"?><rss><channel><title><![CDATA[BBC News]]></title>
    <item><title><![CDATA[Rain &amp; floods in the north]]></title><link>https://bbc.co.uk/1</link></item>
    <item><title>Markets &quot;steady&quot;</title><link>https://bbc.co.uk/2</link></item>
    <item><description>no title</description></item>
    <item><title>Third</title></item></channel></rss>`;
  const r = parseRss(xml, 2);
  assert.equal(r.source, 'BBC News');
  assert.deepEqual(r.items, [
    { title: 'Rain & floods in the north', link: 'https://bbc.co.uk/1' },
    { title: 'Markets "steady"', link: 'https://bbc.co.uk/2' },
  ]);
  assert.deepEqual(parseRss('<html>not rss</html>'), { source: 'News', items: [] });
});

test('cache: reuses within ttl, refreshes after, keeps last good value on failure', async () => {
  let t = 0;
  let n = 0;
  let fail = false;
  const get = cached(async () => {
    if (fail) throw new Error('offline');
    return ++n;
  }, 1000, () => t);
  assert.equal(await get(), 1);
  assert.equal(await get(), 1);
  t = 2000;
  assert.equal(await get(), 2);
  t = 4000;
  fail = true;
  assert.equal(await get(), 2, 'stale but available beats nothing');
});

test('family lineup: TV-G and TV-PG not on the kids channel, never TV-14/TV-MA or horror/thriller', () => {
  const catalog = {
    items: [
      item('cats', 'TV-G', ['Comedy']),
      item('boardroom', 'TV-PG', ['Comedy', 'Workplace']),
      item('waiting-dead', 'TV-PG', ['Horror', 'Thriller']),
      item('queue', 'TV-G', ['Thriller']),
      item('bakeoff', 'TV-14', ['Competition', 'Food']),
      item('it-cats', 'TV-MA', ['Comedy', 'Tech']),
      item('cereal', 'TV-G', ['Kids', 'Reality']),
      item('knight', 'TV-PG', ['Action', 'Comedy']),
      item('insecure', 'TV-PG', ['Comedy'], 'http://example.org/x.mp4'),
      item('knight', 'TV-PG', ['Action', 'Comedy']),
      { id: 'unrated', title: 'U', sources: [{ type: 'mp4', url: 'https://example.org/u.mp4' }] },
      { id: 'broken', content_rating: 'TV-PG' },
    ],
  };
  const family = familyLineup(catalog);
  assert.deepEqual(family.map((i) => i.id), ['boardroom', 'knight'], 'catalogue order, duplicates once');
  assert.equal(family[0].video, 'https://example.org/boardroom.mp4');
  assert.equal(family[0].poster, 'https://example.org/boardroom.jpg');
  const kids = new Set(kidsLineup(catalog).map((i) => i.id));
  assert.ok(family.every((i) => !kids.has(i.id)), 'the two channels never show the same show');
  assert.deepEqual(familyLineup(null), []);
  assert.deepEqual(familyLineup({ items: 'x' }), []);
});

test('scary shows stay off both channels even when their genre looks harmless', () => {
  // Real case from the Scrap TV catalogue: a TV-PG "reality" show about zombie make-up.
  const makeup = { ...item('makeup-mayhem', 'TV-PG', ['Reality']), description: 'Her team transform ordinary people into convincing zombies.' };
  const catalog = { items: [makeup, item('boardroom', 'TV-PG', ['Comedy']), { ...item('cereal', 'TV-G', ['Kids']), title: 'Blood Bank Heist' }] };
  assert.deepEqual(familyLineup(catalog).map((i) => i.id), ['boardroom']);
  assert.deepEqual(kidsLineup(catalog).map((i) => i.id), []);
});

// node:http without keep-alive: fetch's pooled sockets can trip a libuv assertion on Windows when
// --test-force-exit ends the process right after the servers close.
const get = (url: string) =>
  new Promise<{ status: number; body: string }>((ok, fail) => {
    http
      .get(url, { agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => (body += d));
        res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
      })
      .on('error', fail);
  });

test('family channel endpoint: items when the source has them, 503 when it fails or is missing', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'rc-family-'));
  const show = { id: 'boardroom', title: 'Boardroom', description: '', video: 'https://example.org/b.mp4', poster: '', durationSec: 10 };
  let familyOk = true;
  const sources: ChannelSources = {
    kids: async () => [],
    family: async () => (familyOk ? [show] : null),
    news: async () => ({ source: 'Test feed', items: [] }),
  };
  const app = createApp({ staticDir: dataDir, dataDir, sources });
  const port = await app.listen(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${port}`;
    const r = await get(`${base}/api/channels/family`);
    assert.equal(r.status, 200);
    assert.deepEqual((JSON.parse(r.body) as { items: { id: string }[] }).items.map((i) => i.id), ['boardroom']);
    familyOk = false;
    assert.equal((await get(`${base}/api/channels/family`)).status, 503, 'a failed source is reported, not faked');
    assert.equal((await get(`${base}/api/channels/kids`)).status, 200, 'kids still served');
  } finally {
    await app.close();
  }
  // Sources without a family channel (older callers): not configured, not a crash.
  const app2 = createApp({ staticDir: dataDir, dataDir, sources: { kids: sources.kids, news: sources.news } });
  const port2 = await app2.listen(0, '127.0.0.1');
  try {
    assert.equal((await get(`http://127.0.0.1:${port2}/api/channels/family`)).status, 503);
  } finally {
    await app2.close();
  }
});

test('live sources: one catalogue download feeds the kids and family channels', async (t) => {
  const catalog = { items: [item('cereal', 'TV-G', ['Kids']), item('boardroom', 'TV-PG', ['Comedy']), item('bakeoff', 'TV-14', ['Food'])] };
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(String(url));
    if (String(url) === CATALOG_URL) return new Response(JSON.stringify(catalog));
    return new Response('<rss><channel><title>Test feed</title><item><title>One</title></item></channel></rss>');
  });
  const live = liveSources('https://example.org/rss.xml');
  assert.deepEqual((await live.kids())?.map((i) => i.id), ['cereal']);
  assert.deepEqual((await live.family())?.map((i) => i.id), ['boardroom']);
  assert.equal((await live.news())?.source, 'Test feed');
  assert.equal(calls.filter((u) => u === CATALOG_URL).length, 1, 'catalogue fetched once and cached');
});

test('live sources: an unreachable catalogue gives null (honest "unavailable"), not an empty channel', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 502 }));
  const live = liveSources('https://example.org/rss.xml');
  assert.equal(await live.kids(), null);
  assert.equal(await live.family(), null);
  assert.equal(await live.news(), null);
});
