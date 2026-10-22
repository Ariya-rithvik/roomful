# Devpost submission text: Roomful

**Track:** Fire TV (Fire OS app, React Native for TV, built on Amazon's multi-TV starter) · **Mini challenges:** Open Source, AWS Builder
**Repo:** https://github.com/Ariya-rithvik/roomful (fill in after pushing)
**Video:** (YouTube link)

## Tagline
Talk · Recover · Reply · Show. The family TV makes sure nobody at the table is left out.

## Inspiration
A grandparent who is losing their hearing slowly drops out of family conversation. Caption apps put tiny text on one phone they have to hold. The biggest screen in the house is the TV, and everyone already has a phone.

## What it does
- **Join:** everyone scans the QR code on the TV with their own phone. No app to install.
- **Talk:** each phone turns its owner's speech into text. The TV shows big captions with name, colour and avatar, in English, Hindi or Tamil. A cross-talk filter stops two phones from captioning the same sentence twice.
- **Recover:** "I missed that", on a phone or ⏪ on the remote, shows the last minute, with "20 s ago" labels.
- **Reply:** someone who finds speaking hard picks a phrase with the remote; **Amazon Polly** (Kajal) speaks it from their phone.
- **Show:** Table Hunt. The phone camera recognises a real object (on-device detection), and its photo pops onto the TV shelf.
- **Smile:** opted-in phones save 4-second happy moments, played as a "Family break" between kids' shows.
- **Living room and Channel wall:** a kids channel (MIT-licensed Scrap TV shows, filtered to TV-G plus a scary-word filter), BBC headlines, and four channels at once. **Personal sound:** each phone plays the channel its owner chose, in sync with the picture (measured 1–34 ms). "Alexa, pause" works through Fire TV media controls.
- **Help mode:** ☰ on the remote → 5-second countdown → every family phone alarms until someone answers "I'm coming"; the TV turns green.
- **The watchful TV:** real **GDACS** disaster alerts for the family's home area (Chennai). Droughts never take over the screen; a drill is labelled TEST.

## How we built it
- **TV:** React Native for TV (react-native-tvos, Expo SDK 54) on Amazon's react-native-multi-tv-app-sample, with react-tv-space-navigation for focus, expo-video for playback, and a Fire OS APK.
- **Phones:** React + Vite web app using the Web Speech API, MediaPipe for objects and smiles, and MediaRecorder.
- **Server:** Node with a strictly validated WebSocket protocol and clock sync, plus Polly.
- **Design:** warm evening colours, Noto fonts including Devanagari and Tamil, and a focus ring readable from the sofa.

## Testing
- 63 automated tests.
- Verified in the TV web build and as a Fire OS APK on an Android TV emulator, with scripted test phones.
- Personal sound measured at 1–34 ms from the TV picture.
- The real GDACS feed was polled live (211 events).

## Challenges
- Amazon Transcribe and Bedrock were blocked by account verification, so speech recognition runs on each phone.
- Polly's generative voices aren't offered in ap-south-1.
- expo-video on the web reports "playing" while autoplay is blocked.
- Metro served stale bundles on Windows.
- The Vega simulator is not available on Windows. See the friction log.

## What's next
Real-family trials, more languages, an optional room camera that turns to whoever is speaking, and guidance for blind family members.

## Honest limits
- Not a medical device.
- Not yet tested with a real family or on a real Fire TV stick at the time of writing (the video shows: …).
- Hindi and Tamil reply phrases need native-speaker review.

---
## Product feedback (required)
- **Fire TV / multi-TV starter:**
  - Worked well: one codebase ran as a web preview and as a Fire OS APK; focus handling worked out of the box.
  - Needs work: a type error on `main`, missing media and menu keys, release bundling in the monorepo, metaspace, and stale Metro (friction log 6–11).
  - Onboarding: good samples.
  - Would build again: yes.
- **Vega:** we couldn't use it: no Windows support.
- **Amazon Polly:** worked first time with Kajal (us-east-1); not offered in Mumbai.
- **Transcribe / Bedrock:** blocked by account verification ("SubscriptionRequiredException").

**AWS Builder:** Amazon Polly (generative voice Kajal, us-east-1) synthesises spoken replies; audio is cached and played from the speaker's phone (`server/src/tts.ts`). Transcribe streaming code is ready behind `SERVER_SPEECH=transcribe` but was blocked by the account.

## Open Source mini challenge
- **Contribution:** a fix for AmazonAppDev/react-native-multi-tv-app-sample, branch `fix/remote-keys-menu-and-media`.
  - Completes the typed remote-key mapping (fixes TS2739 on `main`).
  - Adds the Fire TV ☰ menu key (keycode 82) and web media keys.
  - PR URL: (fill in after pushing). GitHub: Ariya-rithvik.
- **Why it matters:** apps built on the starter can react to every button on a Fire TV remote, and the starter type-checks.

## Friction log
See `docs/FRICTION-LOG.md` (12 entries).

## Built during the hackathon
Started in the submission window (repo created 2026-10-11).
