# Roomful (repo: roomcaption)

**Talk · Recover · Reply · Show.** Conversation rescue for families on Fire TV.

**The family's own channel on Fire TV.** The Living room screen shows two channels side by side: a kids channel (royalty-free Scrap TV shows from Amazon's developer evangelists, MIT-0) with sound, and a second panel you switch with the remote between live news headlines (public RSS, source shown), live captions of the people in the room, and the evening's happy moments. When a show ends, a "Family break" plays the new happy moments the phones saved. When someone scans a real object with their phone and confirms it, a photo of that actual object pops up on the TV and joins the "brought into the TV" shelf.

**Channel wall and personal sound.** Four channels at once on one TV (kids, family, news, the table's captions). The TV speaker follows the highlighted tile; anyone can tap "Listen on this phone" and hear any video channel on their own phone with earphones, kept in step with the picture (the TV reports position against a synced server clock; the phone seeks and nudges its playback speed; measured 1 to 34 ms behind the TV picture in the web build).

**Recover: "I missed that".** A phone button or ⏪ on the remote shows the last minute of what was said, with how long ago.

**The watchful TV.** Real disaster alerts from GDACS (CC BY 4.0) for the family's home area (Orange/Red events, or anything near home; droughts never take over the screen). A drill exists only with `ALERT_TEST=1` and is labelled TEST.

**Help mode, for parents who can't call for help.** Press ☰ on the TV remote (or "I need help" on the TV or on a phone). After a 5-second countdown that can be cancelled, every family phone goes full screen with an alarm and vibration until someone taps "I'm coming"; the TV then shows "Ravi is coming". Unanswered alerts repeat every 30 seconds. It alerts family only and always shows "call 112"; it is not an emergency service or a medical device. Phones must have the page open to ring (a web page cannot wake a locked phone).

**Under it all: large, live captions of the family table. Every phone is a named microphone.**

A grandparent who is losing their hearing slowly drops out of family conversation. Phone caption apps put tiny text on one phone they have to hold. Roomcaption puts the conversation on the biggest screen in the house: each person joins from their own phone by scanning a QR code, and what they say appears on the TV in large print, with their name and colour, in English, Hindi or Tamil. Someone who finds speaking hard can answer from a reply board with the TV remote; their phone says the reply aloud.

Two family extras run on the same phones and TV:

- **Table Hunt:** the TV asks "Find something soft"; everyone scans a real object with their phone; the first match wins the round. The phone's object detector proposes ("Is this a cup?"), the person confirms or picks from a list, and only the object's name is sent, never a picture.
- **Happy moments and the family channel:** a phone that opts in watches for smiles and saves a 4-second silent clip to the family computer. The TV plays the evening's moments with what was said at that moment, or as a "family channel" next to the live captions. Clips are deleted when the room closes or from Settings.

Status: working end to end on the development PC (web build of the TV app, Fire OS APK on an Android emulator, scripted test phones); not yet tested with a real family, a real phone camera or a real Fire TV stick. See "What is real today".

## How it works

```
 phone (web page, no install)            family PC (Node server)                Fire TV (React Native for TV)
 ─────────────────────────────           ───────────────────────                ─────────────────────────────
 Chrome speech recognition  ──caption──▶  rooms, cross-talk filter, ──caption──▶  large captions, name + colour,
 (on the phone) + clock sync   (WSS)      echo guard, latency log      (WS)      pause / scroll back / text size,
 plays spoken replies       ◀──play────   Polly voice for replies   ◀─reply───  reply board with confirm step
```

- **Who said it:** each phone is one person, so no voice identification is needed. When two phones hear the same sentence, the server keeps the louder or more confident one (`CrossTalkFilter`) and removes the other line. Phones can also be set to hold-to-talk.
- **Replies:** the reply board ranks phrases by fixed rules about the last thing said (question, food, plans…). Nothing is spoken until the person confirms. The reply is spoken by their own phone and captioned on the TV. Phones briefly ignore anything that sounds like a reply just spoken, so the loudspeaker is not captioned as someone else.
- **Timing:** phones and TV keep their clocks in step with the server (ping/pong, lowest round trip), so latency is measured on one clock.
- **Scans and moments stay small:** a hunt scan sends one word (the object label from a fixed safe list). A moment is a 4-second video without sound, uploaded only from phones that switched Moments on, stored on the family computer, and deleted with the room. Scan outcomes (confirmed / corrected / picked) are logged to measure how often the detector is right.
- **Privacy:** speech is turned into text by each phone's own recogniser (in Chrome on Android that is Google's online service, which the join screen says). The server does not record audio or save captions. It keeps timing numbers only, unless it is started in measurement mode (`CAPTURE_TEXT=1`), which phones are told about.

## What is real today

| Part | State |
| --- | --- |
| Protocol, cross-talk filter, caption store, clock sync, WER, reply rules | Done, 23 unit tests |
| Server: rooms, sockets, replies with Polly, latency log, measurement mode | Done, 13 socket-level tests (real WebSockets) |
| Phone web app: join, consent, speech recognition with auto-restart, hold-to-talk, replies | Built; **not yet tried on a real phone** |
| TV app: home + QR, captions, reply board, settings | Runs as a web build against the real server; Fire OS APK being built |
| Amazon Transcribe on the server | Code ready behind `SERVER_SPEECH=transcribe`; **blocked: our AWS account returns SubscriptionRequiredException** (friction log 4) |
| Amazon Polly replies | Working (Kajal, generative, us-east-1) |
| Table Hunt: rules, server scoring, phone scan flow, TV screen | Done and tested (hunt rules + socket tests); full loop verified with the phone page's list fallback. **Camera detection not yet tried on a real phone** |
| Happy moments: smile detector, clip upload/storage/range streaming, reel and family-channel screens | Rules and server tested; TV reel verified with a generated, labelled test clip. **Smile detection and phone recording not yet tried on a real phone** |
| Personal sound + Channel wall | Done: protocol + sync logic tested; verified in the web build (phone 1-34 ms from the TV picture) and on the Android TV emulator (both channels reported). **Not yet on a real phone with earphones** |
| Help mode, GDACS alerts, "I missed that" | Done and tested (socket tests, real GDACS feed polled); verified in the web build and emulator |
| Measured latency / accuracy with real people | **Not yet.** Only scripted-phone timings exist, kept in `measurements/simulated/` and never shown as results |

## Run it

Requirements: Node 22+, a PC and phones on the same Wi-Fi, Chrome on the phones.

```bash
npm install
```

```bash
npm run build:phone
```

```bash
cp server/.env.example server/.env
```

Edit `server/.env`: set `PUBLIC_URL=https://<PC LAN IP>:8787` (the address phones open). The default config serves HTTPS with the self-signed certificate in `certs/` (phones show a warning once: Advanced → Proceed) and plain HTTP for the TV on port 8788.

```bash
npm run start -w server
```

TV app, web preview:

```bash
cd tv-app/apps/expo-multi-tv && npx expo start --web --port 8082
```

TV app, Fire OS APK (needs Android SDK and JDK 17/21; see `scripts/build-apk.ps1`):

```bash
powershell -File scripts/build-apk.ps1 -ServerUrl http://<PC LAN IP>:8788
```

Without real people, `node scripts/sim-phones.mjs <ROOM>` joins three scripted test phones, and `npx tsx scripts/sim-extras.ts <ROOM> measurements/test-media/test-clip.mp4` plays the hunt and uploads a generated test clip (both clearly test tools).

Development note: on Windows, Metro sometimes keeps serving an old bundle after edits in `packages/shared-ui`; restart it with `npx expo start --web --port 8082 --clear`.

## Measure

```bash
npx tsx scripts/summarize.ts server/data
```

prints latency percentiles from `server/data/measurements.jsonl` (speech start → on TV, and server → on TV). For accuracy, run the server with `CAPTURE_TEXT=1`, have people read a script, then pass the script with `--refs refs.json` to get word error rate per speaker and language.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

## Limits (said plainly)

- Not a hearing aid and not a medical device. No clinical testing.
- Who-said-what is reliable when each phone sits near its owner; people talking over each other can still be mis-assigned (hold-to-talk avoids it).
- On-device recognition needs Chrome and an internet connection on the phone. Tamil recognition depends on the phone. Mixed Hindi-English is recognised poorly.
- Hindi reply phrases are drafts until a native speaker reviews them (hidden by default).
- Fire OS only. The Vega SDK does not support Windows, where this was built.

## Layout

`shared/` protocol + pure logic · `server/` Node server · `phone-web/` phone page · `tv-app/` Fire TV app (from Amazon's react-native-multi-tv-app-sample) · `scripts/` build, simulation and measurement tools · `docs/` plan and friction log

MIT licence.
