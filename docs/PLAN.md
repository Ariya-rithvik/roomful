# Roomcaption: full plan (working name)

Status: proposed 2026-10-14. Supersedes the RoomQuest hub as the main entry if gate G0 passes. RoomQuest code stays as reusable base. Deadline: 2026-10-23 12:00 PT (= 2026-10-24 00:30 IST). Submit target: evening 2026-10-22 IST.

## 1. One-sentence pitch

The Fire TV becomes the family's table: it captions the conversation in large print for a grandparent who is losing the thread, using each person's own phone as a microphone, and (stretch) makes a short reel of the family's happy moments.

## 2. Who it helps, honestly

- One real person: an older relative with hearing loss who stops joining in at family meals. Must be a real person we can film with written consent.
- Context numbers (cite sources in Devpost, mark as self-reported survey data): LASI Wave 1 (Peltzer 2022) about 9.9% of Indians 60+ report hearing loss; about 4.3% of them use a hearing aid. WHO lists isolation among the consequences.
- No medical claims. Not a hearing aid. No clinical evaluation.

## 3. Scope tiers (build in this order; each tier ships alone)

| Tier | What | Must work on |
|---|---|---|
| T1 core | Phone mics -> server -> Amazon Transcribe streaming (en-IN, hi-IN) -> large-print, colour-coded captions on Fire TV. Remote: text size, contrast, pause, scroll-back 30 s | real Fire OS stick |
| T2 proof | Latency, word error rate, attribution accuracy, first-frame times (Amazon fireos-perf-testing), elder tester filmed, friction log, Open Source PR | real stick + real person |
| T3 reply (optional) | Reply board: person with speech difficulty picks a suggested reply (ranked by the last captioned sentence, deterministic), confirms, Polly speaks | only if T1+T2 done by Oct 19 |
| T4 reel (optional) | Agent turns captured happy moments into a short video: phone detects smiles/jumps (MediaPipe face blendshapes + pose), keeps a rolling clip buffer locally, picks best clips by rules and score, adds CC0 music and captions; the TV plays it in the interval slot of the kids panel | only if T1+T2 done by Oct 20 |
| T5 scan-to-play (optional) | Phone scans a real object (teddy, cup, book, bottle, remote, clock) with the on-device detector; manual picker for weak classes (book); the object becomes a game item/tool using the existing shared/src/items.ts and RoomQuest Quest code | only if camera test (Oct 15) passes and T4 is stable |
| T6 family channel (optional) | Several panels on one TV screen (for example a kids panel and a news-headlines panel) from our own content only (royalty-free feed such as Amazon's scrap-tv-feed, our own clips, headline text); one panel owns audio via Android audio focus, others show captions; the reel plays in the kids panel breaks | only if T1-T4 are done by Oct 21 |

Cannot do (platform limits, not scope choices): drive or record other apps or real broadcast channels (protected video, no overlay), control TV power/volume/inputs from our app (system or Alexa only), anything needing Bedrock or Translate (both blocked on our AWS account). "Control everything" therefore means everything inside our own app.

Order rule: T1 and T2 are the entry. T3-T6 are added one at a time, each only after the previous is stable on the real stick; anything unfinished on Oct 21 is removed from the video and the Devpost text. Finishing odds fall with every tier added; the judge panel penalised breadth when depth was missing.

## 4. How it works

```
Phone web page (no install)  --WS binary PCM16 16k, 100ms-->  Node server  --Transcribe streaming-->  text
Phone = one named speaker                                   (one stream per phone)             |
                                                                                               v
Fire TV app (react-native-tvos)  <--WS JSON: caption{speaker,text,partial,t_capture}--  server
```

- Join: TV shows QR + short code. Phone opens HTTPS page, enters name, picks language (en-IN or hi-IN), taps explicit mic-consent button. Tamil: not supported for streaming; do not offer.
- Attribution without diarization: each phone has its own Transcribe stream, so the phone's owner is the speaker. Cross-talk handling: per-phone RMS gate, "loudest channel within 300-500 ms wins", text-similarity dedup across phones. Fallback: push-to-talk. Claim only "works when phones sit near their speaker"; report measured accuracy with N.
- Captions: partials shown dimmer, replaced by finals. Colour per speaker plus name label (never colour alone). Rolling window with scroll-back.
- Privacy: audio goes phone -> our server -> Transcribe only; nothing stored by default; optional transcript save is off by default. State this exactly; do not claim "never leaves the home" because Transcribe is cloud.
- HTTPS for phone mics: local TLS (mkcert) on LAN or cloudflared tunnel. Both need a download (ask first).
- Cost guard: Transcribe streaming is billed per second per stream. Cap streams (6), auto-close after 60 s of silence, log minutes used.

## 5. Contract first (me, today)

New `shared/` message types before anyone builds: `join`, `caption`, `ui_setting`, `audio_stats`, plus a separate `/audio` binary WebSocket (existing controller sockets refuse binary frames and cap at 4 KB; keep that rule and add a new endpoint with its own cap). Tests as referee. Lane owners must not edit `shared/` or `server/`; they append to `docs/CONTRACT_REQUESTS.md`.

## 6. Lanes and owners (one owner per folder)

| Lane | Folder | Owner | Work |
|---|---|---|---|
| Core | shared/, server/ | Claude Code (this session) | protocol, audio socket, Transcribe link, dedup/gating, measurement harness, merges, all commits |
| Phone | companion-web/ | Gemini 3.1 Pro | join page, name/language, consent, AudioWorklet capture, level meter, reconnect |
| TV | tv-app/ | Opus 4.6 (second Claude Code session) | QR screen, captions screen, remote controls, 10-foot design |
| New model | docs/ and reel/ (T4) | new model, only after it is confirmed able to edit files | writing, tester pack; T4 clip detection if capable |

Rules: contracts first; tests are the referee; merge twice a day; friction goes to `docs/FRICTION-LOG-INBOX.md`; nobody but me commits.

## 7. Day plan (IST)

| Date | Work | Gate |
|---|---|---|
| Oct 14 (tonight) | Decide. Order stick (4K Max or Cube, not a Vega model). Ask the relative. New repo/branch seeded from motionmates server + TV shell. Write contract + briefs. | |
| Oct 15 | **Day-0 spike (G0):** phone mic over HTTPS -> Node -> Transcribe (ap-south-1, en-IN and hi-IN) -> any screen; measure latency. | G0: mic works, both languages work, latency under ~2 s. If not, English-only or fall back (section 10). |
| Oct 16 | Lanes start. Phone page + server audio socket + TV captions skeleton. Check Fire OS acceptance on the Devpost rules/Q&A. | |
| Oct 17 | End to end on the real stick (G1). First fireos-perf-testing run. | G1: captions on stick. |
| Oct 18 | Remote controls, speaker colours, scroll-back; cross-talk rules; measurement scripts. | |
| Oct 19 | Elder session filmed (consent). Recordings for WER. T3 start only if G1 held. | G2: tester filmed. |
| Oct 20 | Fix what the tester found. Friction log to 15-20 entries. OSS PR(s) to Amazon's starter. T4 only if everything above is done. | |
| Oct 21 | Freeze. Final measured numbers. Video shoot (3 min). README. | G3: freeze. |
| Oct 22 | Edit video, Devpost text, submit by evening IST. | |

## 8. What we measure (every number shown must be measured by us, with N)

- End-to-end latency: phone capture timestamp to TV render, with clock-offset sync; verify 5 samples with 240 fps phone video of the TV.
- Word error rate: 5-10 recorded household-style conversations, English and Hindi separately, scored against hand-typed references; code-switched Hinglish labelled poor if it is.
- Attribution accuracy: staged recordings, correct speaker label rate.
- Fire OS first-frame (TTID) Tp50/Tp90 via AmazonAppDev/fireos-perf-testing (needs JDK 17+, Android SDK API 34, Maven).
- Elder comprehension: small, honest test (same short conversations with and without captions, count facts recalled). Report as n=1 or n=2 case study, not a study.

## 9. Evidence and bonus work

- Friction log: 15-20 entries using chris-trag/friction-log-guide templates; exact doc URLs, expected vs actual, workaround, suggestion. Real entries only.
- Open Source mini-challenge: fix real bugs in AmazonAppDev/react-native-multi-tv-app-sample; check upstream first and link PRs. One mini prize per project.
- Video (3 min): 0:00 the grandparent missing the thread; 0:20 QR join; 0:45 live captions on real stick, two languages; 1:30 remote controls; 2:00 measured numbers card; 2:30 relative's own words; 2:50 what is not done.

## 10. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Phone mic blocked or no HTTPS | mkcert on LAN; else cloudflared |
| hi-IN streaming poor or unavailable in region | English-only; say so |
| Fire OS not accepted for Fire TV Stage 1 | Stop and re-plan; applies to every Fire TV idea |
| Stick late or wrong model | Android TV emulator is a labelled stopgap only; the final video must show the real stick |
| No elder tester | Drop impact claims; show only measurements |
| Cross-talk breaks attribution | Push-to-talk; report the measured failure rate |
| Lanes collide | Contract first; one owner per folder |
| Transcribe cost | Stream cap, silence close, minutes log |

## 11. Do not claim

Hearing aid or medical benefit; "cloning"; Vega; "faster" or "better than" Live Transcribe/Ava without a measured comparison; "tested with" anyone not filmed; Tamil support; on-device or "never leaves the home"; any number we did not measure.

## 12. Known honest weaknesses (say them in the submission)

The core mechanic (QR join, phone as mic, colour-coded speakers) exists in Ava and Microsoft Group Transcribe; the new parts are the shared big screen, large-print elder controls, Hindi/English handling and measured results on a Fire TV. Judge panel scored this idea about 67/100; nothing we evaluated scored near 90.
