# Roomful demo video plan (under 3:00)

Rules this plan follows (Devpost, Fire TV track):
- The video must show the app **running on an actual Fire TV device or the Fire TV / Vega simulator**.
  Best: a Fire TV Stick (Fire OS) on any HDMI monitor, filmed or captured. The Android TV emulator
  (AVD `motionmates_tv`) runs the same Fire OS APK, but it is **not** Amazon's simulator; use it only
  for close-up inserts, labelled "Android TV emulator, same APK".
- Judges may stop at 3:00: the best material goes first.
- No third-party music or footage without permission. Kids/family channel shows are from the Scrap TV
  feed (MIT-0). News headlines are BBC RSS text (titles only, credited on screen).
- AI-generated story clips (Gemini, 10 s each) are allowed only as story illustration and carry the
  on-screen label **"AI illustration"**. Nothing that shows the product working is generated.

## Shot list

| Time | What the viewer sees | How it is captured | Label on screen |
|---|---|---|---|
| 0:00-0:10 | Hook: a family at the table, grandmother can't follow the fast talk; she gives up | Gemini 10 s clip | AI illustration |
| 0:10-0:30 | **Talk**: each person's phone near them; their words appear on the TV with their colour and name; cross-talk from a second phone is dropped | Fire TV (HDMI capture) + real phones, split screen | Real app |
| 0:30-0:45 | **Recover**: grandmother presses ⏪ on the remote → "Catching up · here is what was just said" | Fire TV | Real app |
| 0:45-1:00 | **Reply**: she picks a reply on the TV; her voice (Polly Kajal) speaks from her phone | Fire TV + phone audio | Real app |
| 1:00-1:30 | **Channel wall + personal sound**: four channels at once; the TV speaker follows the highlight; two phones with earphones each hear a different channel, in step with the picture (show the drift readout on the phone: "In step with the TV (12 ms)") | Fire TV + two phones | Real app |
| 1:30-1:50 | **Show**: a child scans a real teddy bear; the photo flies onto the TV and onto the shelf | Phone camera + Fire TV | Real app |
| 1:50-2:05 | **Smile**: happy-moment clips play as a "Family break" between kids' shows | Fire TV | Real app |
| 2:05-2:30 | **Help**: grandmother presses ☰ → 5 s countdown → every phone alarms → "Ravi is coming" turns the TV green | Fire TV + two phones | Real app |
| 2:30-2:45 | **Watchful TV**: the disaster-alert drill (clearly marked TEST) takes over the TV and phones; explain it watches GDACS for the family's home (Chennai) | Fire TV, server started with ALERT_TEST=1 | "TEST drill" (on screen by the app) |
| 2:45-3:00 | Close: "Roomful · Talk · Recover · Reply · Show" + what's real, what's next | Title card | — |

## Before recording
1. Rebuild the APK (`scripts/build-apk.ps1`) with `EXPO_PUBLIC_RC_SERVER_URL=http://<PC-LAN-IP>:8788`, sideload to the stick (`adb connect <stick-ip>`; `adb install -r dist/roomcaption-tv.apk`).
2. Server on the PC with `ALERT_TEST=1` (drill only), phones on the same Wi-Fi, open `https://<PC-LAN-IP>:8787` and accept the self-signed certificate once.
3. Settings on the TV: "Whose TV is this?" = Dadi; text size Large.
4. Phones: real names, earphones for personal sound, Chrome on Android.
5. Do a dry run of the whole list; keep the phone drift readout visible for the personal-sound shot.

## Without a Fire TV stick yet
Record every "Real app" shot on the Android TV emulator and the demo stage (`demo-stage/`), both labelled
as such, so the story is complete; then re-shoot the TV-side shots on the stick before submitting.
The demo stage is a rehearsal tool, not a substitute for the device in the final video.

## Gemini story prompts (each self-contained, 10 s, labelled "AI illustration")
1. "Warm evening, Indian family dinner table, five people talking fast and laughing; an elderly grandmother in a cotton saree looks from face to face, smiling politely but lost; soft lamp light, handheld documentary feel, no text."
2. "Same grandmother on a sofa, a TV glowing in front of her, she presses a remote and leans forward with relief as she reads; camera behind her shoulder, the TV screen is out of focus, warm light, no readable text."
3. "Two children on a carpet with earphones, each looking at their own phone, a big TV in front of them showing four colourful tiles out of focus; cosy living room at night, no readable text."
4. "Night, an elderly man alone at home presses a button on a TV remote; cut to a young man in another room picking up a buzzing phone and walking quickly down a corridor; warm tones, reassuring, no text."
