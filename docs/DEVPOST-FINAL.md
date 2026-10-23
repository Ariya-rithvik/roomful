# Roomful

**Tagline:** Talk · Recover · Reply · Show. The family TV makes sure nobody at the table is left out.

**Track:** Fire TV · **Mini challenge:** AWS Builder
**Repo:** https://github.com/Ariya-rithvik/roomful
**Video:** (paste YouTube link)

---

## Inspiration

In a lot of Indian homes, dinner is loud. Everyone talks at once, in two or three languages, and the jokes fly fast. If you're a grandparent who is slowly losing their hearing, you don't get angry about it. You just quietly stop following, smile, and drift out of the conversation.

Caption apps exist, but they put tiny text on one phone that someone has to hold up. Meanwhile, the biggest, clearest screen in the house is sitting right there: the TV. And everyone at the table already has a phone in their pocket.

So the idea was simple: let every phone be a microphone for its owner, and let the TV be the place where Dadi can actually follow what everyone is saying.

## What it does

**Join in seconds.** The TV shows a QR code. Everyone scans it with their own phone, types their name, and they're in. There's no app to install.

**Talk.** Each phone turns its owner's speech into text, and the TV shows it in big, readable captions with the person's name and colour, in English, Hindi or Tamil. When two phones hear the same sentence, a cross-talk filter keeps only one copy.

**Recover.** Missed something? Press Rewind on the Fire TV remote, or tap "I missed that" on a phone. The last minute comes back on screen with "20 s ago" labels, so nobody has to repeat themselves.

**Reply.** For someone who finds speaking hard, there's a reply board. They pick a phrase with the remote, and Amazon Polly says it out loud from their own phone, so the voice comes from where they're sitting.

**Help.** Press the Menu button on the remote, and after a 5-second countdown (in case it was an accident) every family phone alarms until someone answers "I'm coming". Then the TV turns green and says who is on the way.

**The watchful TV.** Roomful watches real GDACS disaster alerts for the family's home area (Chennai in our setup) and takes over the screen when something actually concerns them. Drills are clearly labelled TEST.

**For the kids, and everyone else.** There's a kids' channel (open-licensed shows, filtered for age, plus our own scary-word filter), BBC headlines, a Channel wall with four channels at once, and personal sound: each phone plays the audio of the channel its owner picked, in sync with the picture (we measured 1–34 ms off). There's also Table Hunt, where kids show a real object to the phone camera and its photo pops onto the TV, and short opt-in "happy moment" clips played as a family break.

## How we built it

- **TV app:** React Native for TV (react-native-tvos, Expo SDK 54), built on Amazon's react-native-multi-tv-app-sample, with react-tv-space-navigation for remote focus and expo-video for playback. It ships as a Fire OS APK.
- **Phones:** a React + Vite web app using the Web Speech API for captions, MediaPipe for object detection, and MediaRecorder for clips.
- **Server:** Node with a strictly validated WebSocket protocol and clock sync (which is what keeps personal sound in step), plus Amazon Polly for spoken replies.
- **Design:** warm evening colours, Noto fonts that cover Devanagari and Tamil, and a focus ring you can actually see from the sofa.

## Testing

There are 63 automated tests. We tested the TV side as a web build and as the release Fire OS APK on an Android TV emulator, with scripted test phones. The demo video was recorded straight from that APK on the emulator, driven with real remote key events, and it's labelled that way on screen. The real GDACS feed was polled live.

## Challenges we ran into

- Amazon Transcribe and Bedrock were blocked on our account by verification, so speech recognition runs on each phone instead. That turned out well for privacy: no audio leaves the phone.
- Polly's newer voices aren't available in the Mumbai region, so we use us-east-1.
- On Windows, Metro sometimes served stale JavaScript, and Gradle once reused an old JS bundle in a release APK. That one hid a real bug: our "catch up" screen reopened on every re-render, so on a TV it couldn't be closed. We only caught it because we recorded the demo from the actual APK, and it's fixed now.
- The Vega simulator doesn't run on Windows, so we used the Fire OS path instead.

## Accomplishments that we're proud of

- It feels like a TV app, not a phone app on a big screen. Everything works from the remote.
- Personal sound lands within a few dozen milliseconds of the picture.
- Help mode is calm: a countdown, then the whole family's phones, then a clear "Ravi is coming".

## What we learned

Accessibility features work best when nobody has to feel singled out. Roomful doesn't announce "captions for grandma"; it's just the family channel, and everyone uses it.

## What's next

Trials with real families, more Indian languages, an optional room camera that turns to whoever is speaking, and guidance for family members who are blind.

## Honest limits

Roomful is not a medical device. We haven't yet tested it with a real family or on a physical Fire TV stick; the video shows the same release APK on the Android TV emulator, with scripted test phones, labelled on screen. The Hindi and Tamil reply phrases still need a native speaker's review.

## Built with

react-native · react-native-tvos · expo · fire-tv · fire-os · typescript · node.js · websockets · vite · react · web-speech-api · mediapipe · amazon-polly · aws · gdacs

---

## Product feedback (paste into the feedback field)

**Fire TV / multi-TV starter.** Really good starting point: one codebase ran as a web preview and as a Fire OS APK, and remote focus handling worked out of the box. Things that slowed us down: a type error on `main`, missing media and menu keys in the remote mapping, release bundling in the monorepo, and Gradle reusing a stale JS bundle after edits in a workspace package. Would build again: yes.

**Vega.** We couldn't try it, because the simulator isn't available on Windows.

**Amazon Polly.** Worked first time with the Kajal voice in us-east-1. It would be nice to have the newer voices in the Mumbai region.

**Transcribe and Bedrock.** Blocked by account verification ("SubscriptionRequiredException"), so we moved speech recognition onto the phones.

**AWS Builder:** Amazon Polly (voice Kajal, us-east-1) speaks the replies chosen on the TV. Audio is cached on the server and played from the speaker's own phone (`server/src/tts.ts`). Transcribe streaming is ready behind `SERVER_SPEECH=transcribe`, but our account was blocked.

Full details are in `docs/FRICTION-LOG.md` (13 entries).
