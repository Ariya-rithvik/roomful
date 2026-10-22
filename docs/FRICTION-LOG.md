# Friction log

Kept for the Devpost product-feedback section (worth up to a 10% judging bonus). Only problems we actually hit are listed, each with the date and where it was verified. Unverified suspicions go in the last section until they are confirmed.

Entry fields: date, tool / API / SDK, task attempted, steps taken, expected, actual, severity, workaround, suggestion.

---

## 1. No supported Windows path for the Vega SDK

- **Date:** 2026-10-11
- **Tool:** Vega SDK and Vega Developer Tools (docs v0.24)
- **Task:** Pick a development path on Windows 11 for the Fire TV track.
- **Steps:** Read the Vega SDK install page and the Fire TV guide for Vega OS, looking for a Windows or WSL route.
- **Expected:** A supported way to build and test Vega apps on Windows.
- **Actual:** Both pages require a Mac or Ubuntu machine; Windows and WSL are not supported. The hackathon page presents Fire OS and Vega OS as equal options.
- **Severity:** High for Windows developers.
- **Workaround:** Build for Fire OS (React Native for TV, Android emulator, ADB to a Fire OS stick).
- **Suggestion:** Document an official Windows route (WSL2 with KVM, or a hosted Vega Virtual Device), and state the OS requirement on the hackathon Resources page.

## 2. Bedrock: "Your account is currently being verified"

- **Date:** 2026-10-13
- **Tool:** Amazon Bedrock runtime (Converse, InvokeModel), us-east-1
- **Task:** Smoke-test Nova text and Nova Canvas before building on them.
- **Steps:** Converse on `amazon.nova-micro-v1:0` (worked once), its `us.` inference profile, Nova Lite, Nova Pro; InvokeModel on Nova Canvas.
- **Expected:** Access, or an error saying what is missing.
- **Actual:** `AccessDeniedException: Your account is currently being verified...` on every model after the first call; nothing says which step is pending. Polly kept working on the same credentials.
- **Severity:** Blocker for any Bedrock feature; this project dropped Bedrock entirely.
- **Workaround:** Design without Bedrock (reply suggestions are rule-based).
- **Suggestion:** Show the pending verification step in the console and the error, and allow a small trial quota during verification.

## 3. Amazon Translate: "The AWS Access Key Id needs a subscription for the service"

- **Date:** 2026-10-13
- **Tool:** Amazon Translate TranslateText, us-east-1
- **Task:** Translate caption lines English → Hindi / Tamil.
- **Actual:** `SubscriptionRequiredException` on every call, with no pointer to what to subscribe to.
- **Severity:** Medium. Translation is not in the product.
- **Suggestion:** Put the activation link in the error text.

## 4. Amazon Transcribe streaming: same "needs a subscription" error, in every region tried

- **Date:** 2026-10-15
- **Tool:** Amazon Transcribe streaming (`@aws-sdk/client-transcribe-streaming` 3.x, StartStreamTranscription) and `aws transcribe list-transcription-jobs`, ap-south-1 and us-east-1
- **Task:** Day-0 spike for live captions: synthesise English and Hindi sentences with Polly as 16 kHz PCM, stream them to Transcribe in real time (100 ms chunks), measure time to first partial and final.
- **Steps:** `spikes/transcribe/spike.mjs`; then the CLI list call in both regions to rule out the SDK.
- **Expected:** Transcripts (en-IN and hi-IN are listed as streaming languages), or a clear activation step.
- **Actual:** `SubscriptionRequiredException: The AWS Access Key Id needs a subscription for the service` from both the streaming API and the plain CLI call, in both regions. IAM, Polly and STS work with the same keys.
- **Severity:** Blocker for the planned Amazon speech path.
- **Workaround:** Speech recognition moved onto each phone (browser Web Speech API). The Transcribe adapter stays in the server behind `SERVER_SPEECH=transcribe`, ready for when the account is enabled.
- **Suggestion:** Same as entry 3: say in the error which subscription is missing and link it. A new account's status page could list which AI services are not yet enabled.

## 5. Polly generative voices are not offered in ap-south-1 (Mumbai)

- **Date:** 2026-10-15
- **Tool:** Amazon Polly SynthesizeSpeech, `Engine: generative`, voice Kajal (en-IN / hi-IN)
- **Task:** Make test audio for the spike from the region nearest to India.
- **Actual:** `ValidationException: The selected engine is not supported in this region` in ap-south-1. The same call works in us-east-1.
- **Severity:** Low (easy workaround), but surprising: Kajal is the Indian English and Hindi voice, yet its generative engine is not served from the Indian region.
- **Workaround:** Polly client pinned to us-east-1 (`server/src/tts.ts`).
- **Suggestion:** Show engine availability per region on the voice list page, and offer the generative Indian voices in ap-south-1.

## 6. Multi-TV starter: release JS bundling fails in the monorepo

- **Date:** 2026-10-11 (verified again 2026-10-16 when building this app)
- **Tool:** AmazonAppDev react-native-multi-tv-app-sample (Expo, Yarn workspaces), `gradlew assembleRelease`
- **Actual:** `createBundleReleaseJsAndAssets` fails with `Unable to resolve module ./node_modules/expo/AppEntry.js` because `nmHoistingLimits: workspaces` keeps the app's packages in its own `node_modules`.
- **Workaround:** `EXPO_NO_METRO_WORKSPACE_ROOT=1` (see `scripts/build-apk.ps1`).
- **Suggestion:** Set it in the starter's Android build scripts, or document it in the README. (Candidate Open Source fix.)

## 7. Multi-TV starter: default Gradle metaspace too small for a release build

- **Date:** 2026-10-11
- **Actual:** `OutOfMemoryError: Metaspace` during lint / dex merge with Gradle defaults.
- **Workaround:** `-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g`.
- **Suggestion:** Ship a `gradle.properties` with these values. (Candidate Open Source fix.)

## 8. Multi-TV starter: typecheck fails out of the box; remote mapping lacks media keys

- **Date:** 2026-10-11 (media keys verified again 2026-10-16)
- **Actual:** `packages/shared-ui` cannot resolve `react` / `react-native` under `tsc` (same hoisting cause); `RemoteControlManagerInterface.addKeydownListener`'s return type does not match its implementations; the web key mapping has no Play/Pause, Rewind or Fast-forward, so a captions app cannot be paused from a keyboard or media remote in the web build.
- **Workaround:** a separate `tsconfig.typecheck.json`; media keys added in `RemoteControlManager.ts`.
- **Suggestion:** Fix in the starter. (Candidate Open Source fix.)

## 9. Multi-TV starter on web: nested buttons

- **Date:** 2026-10-11
- **Actual:** On web, `SpatialNavigationFocusableView` already renders a `<button>`; the starter's `FocusablePressable` wraps a `Pressable` inside it, producing nested-button hydration errors.
- **Suggestion:** Render a plain `View` inside the focusable on web.

## 10. expo-video on web: `player.playing` stays true when the browser blocks autoplay

- **Date:** 2026-10-18
- **Tool:** expo-video ~3.0.15 (web), used by the multi-TV starter's player
- **Task:** report the kids channel's position so phones can play its audio in sync ("personal sound").
- **Expected:** `playing` false while the `<video>` element is paused by Chrome's autoplay policy.
- **Actual:** `playing` stays true and `playingChange` fires thousands of times per second while `play()` and `pause()` interrupt each other (`AbortError: The play() request was interrupted by a call to pause()`). Our report flooded the server at ~4,000 messages/s.
- **Severity:** medium (web preview only; did not reproduce in the Fire OS build).
- **Workaround:** treat "playing" as true only when `currentTime` moves; throttle event-driven reports (trailing, so the last state always lands); rate-limit on the server.
- **Suggestion:** surface the autoplay rejection as a status/error event on web and keep `playing` in step with the element.

## 11. Metro on Windows serves a stale bundle after edits in a workspace package

- **Date:** 2026-10-16 to 10-18 (hit five times)
- **Actual:** edits under `packages/shared-ui` did not reach the web preview until Metro was restarted with `--clear`; the served bundle still contained the old function bodies (checked by fetching the bundle).
- **Workaround:** `npx expo start --web --clear` after shared-package edits.
- **Suggestion:** watch workspace packages in the starter's `metro.config.js` (open PR #138 may cover it).

## 12. Fire TV demo requirement vs. tooling on Windows

- **Date:** 2026-10-19
- **Actual:** the hackathon asks for the app running on a real Fire TV or the "Fire TV / Vega simulator". The Vega Developer Tools (and so the Vega Virtual Device) support only macOS and Ubuntu; Windows is listed as not supported (https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html), so a Windows developer without a stick can only use a generic Android TV emulator (AVD) with the Fire OS APK, which is not an Amazon simulator and plays video at ~1/3 speed with software rendering.
- **Workaround:** Android TV AVD for development; a Fire TV Stick for the final video.
- **Suggestion:** an official Fire OS emulator image (or AVD skin + system image) for Windows, or a clear statement of which emulator counts.

## What worked well

- `react-tv-space-navigation` handled every screen (button grids, confirm dialogs) without custom focus code.
- The `react-native-keyevent` plugin delivered D-pad, Back and media keys on the first try.
- One codebase ran unchanged as a web preview and as the Android TV build.
- Polly generative Kajal (us-east-1) produced natural Indian English for spoken replies on the first call.
- The Scrap TV feed (chris-trag/scrap-tv-feed, MIT-0) gave a legal, ready-to-play kids channel in minutes: `catalog-fullUrls.json` has direct MP4 links with range support, ratings and genres, so filtering to TV-G and playing on Fire OS needed no extra hosting. (Small gap: no per-item "kids-safe" flag beyond the rating and genres, so we filter TV-G and drop Horror/Thriller ourselves.)

---

## To verify before logging

- Is there an official Amazon page listing which current sticks run Fire OS and which run Vega?
- Can a third-party Fire OS app receive the Alexa remote's microphone? (Our reading: no; only Alexa-routed commands.)
- Transcribe streaming language list says ta-IN is batch-only: confirm once the account is enabled.
