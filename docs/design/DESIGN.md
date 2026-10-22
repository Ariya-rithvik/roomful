# Roomful visual system (v1)

Status: proposal, 2026-10-17. Pairs with `CONCEPT.md` and `mockups.html`. Written so one developer can land it in a day; section 9 is the order of work.

## 1. Principles

1. **People first, chrome last.** Names, faces (avatars), captions and the objects people bring are the biggest things on screen. App chrome is quiet.
2. **Readable from the sofa.** At 3 m: nothing on the TV under 24 px, body 30 px and up, captions 52 px and up (design pixels at 1920x1080).
3. **Never colour alone.** A person is colour + initial avatar + name. Focus is ring + lift + fill. Selected is a check icon + border.
4. **Warm evening light.** Warm near-black, cream text, one marigold accent. No pure black, no pure white glare.
5. **One thing moves at a time.** Motion is for arrivals, focus and transitions. Caption text never animates its size.

## 2. Colour tokens

### TV and phone, dark "Evening" theme (contrast measured against `bg.base` / `surface.2`)

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `bg.base` | `#16110F` | screen background | |
| `bg.glow` | `#2A1D16` | top-left stop of the background gradient (lamp light) | |
| `surface.1` | `#211A17` | panels, shelf, cards | |
| `surface.2` | `#2D2420` | buttons, raised cards | |
| `surface.3` | `#3A2F2A` | selected tab, pressed | |
| `line` | `#45382F` | hairlines, panel borders | decorative |
| `line.strong` | `#6A5A4E` | keycaps, inputs, dashed empty seats | 3:1 |
| `text.strong` | `#FFF7EE` | titles, captions (final), names | 17.6 / 14.3 |
| `text` | `#F3E9DF` | body | 15.6 / 12.7 |
| `text.muted` | `#CDBFB3` | secondary, partial captions | 10.4 / 8.5 |
| `text.faint` | `#A8998D` | timestamps, key legend; 24 px+ only | 6.8 / 5.5 |
| `accent` | `#FFB547` | marigold: brand, "now" markers, active-tab underline | 10.7 / 8.6 |
| `accent.ink` | `#2A1A05` | text on accent | 9.6 on accent |
| `focus.fill` | `#FFF1DC` | focused control fill | |
| `focus.ink` | `#1C1410` | text/icons on focus.fill and on person colours | 16.3 |
| `focus.ring` | `#FFF7EE` | 4 px ring, 4 px gap outside the control | |
| `ok` / `warn` / `bad` | `#8EE39A` / `#FFCF6B` / `#FF9A8A` | status, always with an icon + word | ≥ 7.4 |
| `scrim` | `rgba(12,8,6,0.72)` | behind object arrival and dialogs | |

Background: a linear gradient from `bg.glow` (top-left) to `bg.base` (60%) using `expo-linear-gradient` (already a dependency). Video and photo wells stay `#000`.

### People colours (replace `SPEAKER_COLORS` in `shared/src/protocol.ts`)

`#7CC4FF` sky · `#FF8B7B` coral · `#93DB8C` leaf · `#C6A8FF` lilac · `#FF94C2` rose · `#63D6C6` teal.
All ≥ 6.6:1 on every dark surface; `focus.ink` on each ≥ 8:1 (avatar initials). None of them is the brand marigold, so a person is never confused with a highlight (today Meena's yellow equals the accent and the toast colour). Sky/teal and coral/rose are close for colour-blind viewers, which is why the initial and the name are always shown.

### Phone light theme (`prefers-color-scheme: light`)

`bg #FBF6EF` · `surface #FFFFFF` · `surface.2 #F3ECE3` · `line #E3D8CB` · `text #1F1712` (16.4) · `muted #6B5D52` (5.9) · primary button stays marigold `#FFB547` with `#2A1A05` text plus a `0 2px 0 #D9922A` bottom edge. Person colours as text on light use ink variants: sky `#0B6BB8`, coral `#C2412F`, leaf `#2E7D32`, lilac `#6B4BC4`, rose `#B8336E`, teal `#0E7C70` (all ≥ 4.7:1). Avatars keep the bright fill with dark initial.

### Caption themes (`captionThemes` in `rc/config.ts`)
`dark`: bg `#16110F`, text `#FFF7EE`, partial `#A8998D`. Keep `yellow` (`#000` / `#FFE14D`) and `light` (`#FBF6EF` / `#1F1712`, partial `#6B5D52`) as accessibility presets.

## 3. Typography

All SIL Open Font License, on Google Fonts, free to bundle.

| Role | Latin + Hindi | Tamil | Weights |
|---|---|---|---|
| Display (moments of delight) | **Baloo 2** | **Baloo Thambi 2** | 700, 800 |
| Text (UI and captions) | **Noto Sans** + **Noto Sans Devanagari** | **Noto Sans Tamil** | 400, 600, 700 |

Baloo is used only for: wordmark, hunt prompt, arrival headline, family-break title, winner banner, big numbers. Everything else is Noto.

Script rules:
- Pick the family by the line's language, not by fallback: `fontFor(lang, weight)` returns `NotoSans-*` for `en-IN`, `NotoSansDevanagari-*` for `hi-IN`, `NotoSansTamil-*` for `ta-IN` (each also contains Latin, so mixed lines render).
- On React Native Android, `fontWeight` with custom fonts is unreliable: use one family name per weight file (`NotoSans-SemiBold`) and do not set `fontWeight`.
- Never apply `letterSpacing` or uppercase to Devanagari or Tamil (spacing breaks conjuncts). `label` style is Latin-only.
- Line height: 1.25 for Latin, 1.45 for Devanagari and Tamil (taller vowel signs).

### TV scale (design px)

| Token | Size / line | Font | Use |
|---|---|---|---|
| `display.xl` | 120 / 128 | Baloo 800 | hunt prompt |
| `display.l` | 88 / 96 | Baloo 800 | home welcome line |
| `display.m` | 64 / 72 | Baloo 800 | arrival headline, family break title, winner banner |
| `title` | 48 / 58 | Noto 700 | screen titles |
| `heading` | 36 / 44 | Noto 700 | panel titles, names on Home |
| `body.l` | 34 / 46 | Noto 600 | button labels, captions in the side panel |
| `body` | 30 / 42 | Noto 400 | explanations, headlines |
| `label` | 24 / 28 | Noto 700, +0.08em, uppercase | section labels (Latin only) |
| `meta` | 24 / 32 | Noto 400 `text.faint` | footers, key legend. Absolute minimum |

Full-screen captions keep `textSizes` 52 / 66 / 84 / 104; the speaker name above each line is 0.5x the caption size, Noto 700.

### Phone scale (CSS px, base 17)
`display` 34/40 Baloo 800 · `title` 24/30 Noto 700 · `heard` 24/34 Noto 600 · `body` 17/26 Noto 400 · `small` 15/22 muted (minimum 14) · `label` 13/16 Noto 700 uppercase +0.08em · `button` 18/24 Noto 700.

## 4. Space, layout, radii, elevation

- **TV spacing** (8-pt): 4, 8, 16, 24, 32, 48, 64, 96. Every text and focusable stays inside title-safe 90 / 54; backgrounds bleed. Content box 1740 x 972.
- **Living room grid**: top bar 72 · gap 24 · video 1056 x 594 (16:9) + gap 32 + right panel 652 x 594 · gap 24 · shelf 196 · gap 16 · key legend 40. Total 966.
- **Phone spacing** (4-pt): 4, 8, 12, 16, 24, 32, 48. Side gutter 16, max width 480 centred. Tap targets ≥ 48 x 48; primary actions 56 tall; bottom tab bar 64 + `env(safe-area-inset-bottom)`.
- **Radii TV**: keycap 8 · chip 12 · button 20 · panel/video 28 · hero card 40 · pill 999. **Phone**: 10 · 14 (inputs, buttons) · 20 (cards) · 28 (sheets) · pill.
- **Elevation (dark)**: e0 `bg.base`; e1 `surface.1` + 1 px `line`; e2 `surface.2` + shadow `0 8 24 rgba(0,0,0,.35)` (Android `elevation: 4`); e3 focused: `focus.fill` + ring + shadow `0 16 40 rgba(0,0,0,.5)` (`elevation: 12`); e4 overlay (arrival, toast) shadow `0 24 64 rgba(0,0,0,.6)` over `scrim` (`elevation: 24`).

## 5. Motion

Tokens: `fast` 150 ms, `base` 250, `slow` 400, `hero` 600. Enter easing `Easing.bezier(0.2, 0, 0, 1)`; exit `Easing.bezier(0.3, 0, 1, 1)`; arrival spring `friction 7, tension 70`. Only `transform` and `opacity`, `useNativeDriver: true`. If `AccessibilityInfo.isReduceMotionEnabled()` is true, every rule below becomes a 200 ms crossfade.

- **Focus**: ring and fill switch instantly (older eyes need immediate feedback); scale 1.00 → 1.05 over `fast`.
- **Person joins**: seat avatar scales 0.6 → 1 (`base`, spring) + toast "Ravi joined" with his avatar.
- **New caption line**: translateY 16 → 0 and opacity 0 → 1 over `base`. Partial to final: colour only, no layout shift. Older lines step to 0.72 opacity.
- **Object arrival** (4.4 s, `rc/ObjectArrival.tsx`): 0-250 scrim fades in · 150-750 card rises from y+120, scale 0.7 → 1, rotate -6° → -2° (spring) · 12 confetti dots in the bringer's colour burst outward and fade (600) · hold 3000 · 600 exit: card scales to 0.28 and translates toward the shelf slot (bottom-left) while the scrim fades; the shelf item then pops 0.8 → 1. Kids-channel audio keeps playing.
- **Family break** (`LivingRoomScreen.tsx` + `ReelPlayer.tsx`): show ends → video dims to 30% (`slow`) → title card "Family break" + "3 happy moments from tonight" on a marigold-to-coral gradient wipe from the left (`hero`), hold 1.8 s → clips crossfade (300 ms) with a lower-third caption → "Back to the kids channel" card 1.2 s → next show.
- **Toast**: drop 24 px + fade in `base`, hold 4 s, fade out `fast`.
- **Hunt win**: winner banner scales 0.9 → 1 (spring); their score number pops 1 → 1.25 → 1 with "+1" floating up 40 px and fading.

## 6. Icons

Inline SVG, 24 x 24 grid, stroke 2 (scale stroke with size: 3 at 40 px, 4 at 56 px), round caps and joins, `currentColor`, filled variant only for the active tab. No icon fonts, no emoji in UI (emoji render differently per Android version and look like placeholders). Set (paths are in `mockups.html` `<symbol>`s, ready to copy): `mic`, `stop`, `camera`, `smile`, `tv`, `play`, `pause`, `sound`, `mute`, `next`, `arrow-up/down/left/right`, `ok`, `back`, `check`, `close`, `sparkle`, `shield`, `users`.
- **Phone**: a 20-line `Icon.tsx` that renders `<svg viewBox="0 0 24 24">` from a path map.
- **TV**: `npx expo install react-native-svg` (Expo SDK package; needs the APK rebuild you already do) and the same path map. If a new native module is too risky this week, export the SVGs to 96 px PNGs and tint with `tintColor`.

## 7. Components

### TV
- **FocusButton** (`Btn` in `rc/ui.tsx`): height 88 (small 68), padding 0 40, radius 20, `surface.2`, 2 px `line`; label `body.l` (small 28) `text.strong`; optional leading icon 40; hint line `meta`. **Focused**: wrapper View with 4 px border `focus.ring` and 4 px padding (the gap), inner fill `focus.fill`, label `focus.ink`, scale 1.05, e3. **Selected**: leading check icon + 3 px `accent` border + `surface.3` (never colour alone). **Disabled**: opacity 0.4, label suffix "(join first)" where useful.
- **Person** (replaces `SpeakerTag`): avatar circle 40 / 56 / 96 in person colour with initial (first code point, `focus.ink`, Noto 700 at 0.45x avatar size); name `heading` in `text.strong`; language in its own script ("हिन्दी", "தமிழ்", "English") in `text.muted`. **Offline**: avatar becomes a 3 px dashed outline + "phone offline". **Speaking**: 4 px ring in person colour with 4 px gap + three level bars.
- **Seat** (Home): up to `MAX_SPEAKERS` (6) seats; empty seat = 96 px dashed `line.strong` circle with "+" and "Free seat".
- **CaptionLine**: 8 px rounded rail in person colour; avatar 40 + name (24 px Noto 700 in person colour); text `body.l` (side panel) or `textSizes` (full screen). Partial: `text.muted` + " …"; final: `text.strong`. Reply lines carry a small "via reply board" tag with the `sound` icon.
- **ChannelPanel**: radius 28, overflow hidden. Video: top scrim gradient 0 → 55% black, channel label (`label`, accent) + show title (36 Noto 700); state badge top-right with icon + word ("Paused", "Muted"). Right panel: segmented header **Table talk · Moments · Headlines**; active segment = `surface.3` fill + 4 px `accent` underline + `text.strong`; inactive `text.muted`; a small ▲▼ keycap at the end of the header.
- **ShelfItem**: "instant photo" card 160 x 188: `#FFF4E6` frame, 10 px padding, photo 140 x 112 radius 10, label 24 Noto 700 `focus.ink`, bringer avatar 36 overlapping top-right; alternate tilt -2° / +1.5°; newest gets a marigold "NEW" tab.
- **Toast**: top centre, pill, `surface.3`, 2 px `line.strong`, leading 32 icon or avatar, text 30 Noto 600, max width 1200.
- **KeyLegend** (replaces the `▲▼ ◀ ⏯` text lines): keycap 40 x 40 radius 8, 2 px `line.strong`, icon 24 `text.muted`, label `meta`; max 5 items, 32 apart; include "Say 'Alexa, pause'" on the Living room.
- **QR card**: `#FFF7EE` card, radius 40, padding 32, QR 380; room code below in Noto 700 64, letter-spaced 0.2em, `focus.ink`.

### Phone
- **Tab bar**: fixed bottom, 64 + safe area, translucent `surface` + 1 px top `line` + blur. Items **Talk / Show / Smile**: icon 26 + label 13/700. Active: 64 x 32 pill behind the icon (`surface.3` dark, `#F3ECE3` light), filled icon, `text.strong` label, 3 px marigold bar at the top edge. A dot on Show while a hunt is running.
- **Mic button**: 168 px circle, centred. Idle: marigold fill, `mic` icon 56 in `accent.ink`, caption "Tap to talk". Listening: fill = the person's colour, `stop` icon, two expanding rings in that colour (1.6 s loop), live level bars, caption "Listening, tap to stop". No red: red reads as an error and worries older users. Hold mode: "Hold to talk", pressed scale 0.96.
- **Heard card**: `surface` card, 24/34 text, partial words in `muted` with a blinking caret; small label "On the TV now".
- **Scan card**: 3:4 viewfinder, radius 20, cream corner brackets; on "propose" show the frozen frame (the canvas already in `frameRef`) with the detection box and a chip "Teddy bear"; bottom sheet "Is this a teddy bear?" with **Yes, show it on the TV** (56, marigold) and **No, something else** (56, outline); line "Only this cropped photo and its name are sent."
- **Consent card**: title "Before you join"; three rows with icons (mic: "Your speech becomes text on this phone. In Chrome that is Google's online service." · tv: "It is shown on the TV in your home." · shield: "Nothing is recorded. Only timing numbers are kept."); 56 px checkbox row "I agree".
- **Language cards**: three radio cards (English · हिन्दी · தமிழ்), native script big, English name small; selected = 2 px marigold border + check icon.

## 8. Mapping to existing files

| File | Change |
|---|---|
| `tv-app/.../rc/config.ts` | Swap `palette` values to tokens (keep the keys: `bg, panel, panelHi, line, text, muted, accent, ok, warn, bad, focus`) so every screen picks up the theme with no other edits. Retune `captionThemes.dark`. |
| new `tv-app/.../rc/theme.ts` | Full token set, `fontFor(lang, weight)`, motion constants. |
| `tv-app/apps/expo-multi-tv/App.tsx` | `useFonts` with the 13 static files (Baloo 2 700/800, Baloo Thambi 2 800, Noto Sans / Devanagari / Tamil 400/600/700, Noto Sans 700 for labels) placed in `assets/fonts` with their OFL. |
| `rc/ui.tsx` | `type` → TV scale; `Btn` → FocusButton; `SpeakerTag` → `Person` (+ `Avatar`); `Toast` restyle; new `KeyLegend`, `Seat`, `Icon`. `Pill` gets an icon. |
| `screens/HomeScreen.tsx` | Left: QR card + "Scan with your phone camera" + room code. Right: "Who's here" with 6 seats, then one big **Start the evening** (→ Living room), then **Big captions · Table Hunt · Settings**. Move server URL and New room into Settings; drop the Happy moments button. Footer: privacy line only. |
| `screens/LivingRoomScreen.tsx` | Grid from section 4. `PANELS` order `captions, moments, news`; start on `captions` when `speakers.length > 0`. Top bar: wordmark + room code + `Person` chips (speaking ring from partials, as `CaptionsScreen` already computes). Shelf → `ShelfItem`. Hint line → `KeyLegend`. |
| `rc/ObjectArrival.tsx` | Instant-photo card (cream frame, -2° tilt), scrim, confetti, headline `display.m` with the name in person colour, Hindi object name below when `drafts` is on, exit toward the shelf. |
| `rc/ReelPlayer.tsx` + family break | Lower-third caption bar with avatar; break title card per section 5. |
| `screens/HuntScreen.tsx` | Prompt `display.xl`; winner banner with avatar, the winner's object photo (latest `objects` entry with the winner's `speakerId` and that label), scoreboard of `Person` rows with big numbers; "Just shown" list with check / cross icons. |
| `screens/CaptionsScreen.tsx` | Strip → `Person` chips; lines → `CaptionLine`; banner with icon; legend → `KeyLegend`. |
| `screens/ReplyScreen.tsx` | 2 x 4 grid of reply cards 400 x 140; confirm screen uses `display.m` for the phrase and the replying person's avatar. |
| `screens/SettingsScreen.tsx` | Same controls as rows; adds server URL, New room. |
| `theme/*.ts`, `components/FocusablePressable.tsx` | Template leftovers (only `safeZones` is used). Leave them; do not mix them with the new tokens. |
| `phone-web/index.html` | Title "Roomful", `theme-color` `#16110F`, font link (or self-host woff2 in `public/fonts` so a phone with weak internet still renders). |
| `phone-web/src/styles.css` | Tokens as CSS variables, light theme block, type scale, tab bar, mic, cards; `font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Tamil', system-ui`. |
| `phone-web/src/App.tsx` | Tabs to the bottom, renamed Talk / Show / Smile, emoji → `Icon`; language radio cards; consent card; mic button states; avatar in the top bar. |
| `phone-web/src/Extras.tsx` | Show the frozen frame + box during "propose"; button copy above; Smile tab copy and toggle as a 56 px switch row. |

## 9. One-day order of work

1. (30 min) Palette values in `config.ts`, `SPEAKER_COLORS`, phone CSS variables. Already a visible lift.
2. (1 h) Fonts on TV and phone; `type` scale; `fontFor`.
3. (1 h) `Btn` focus ring, `Avatar`/`Person`, `KeyLegend`, `Icon`.
4. (2 h) Home and Living room layouts.
5. (1 h) Object arrival + shelf; family break card.
6. (1 h) Hunt round-won; phone tab bar, mic, scan confirm, consent.
7. (30 min) Check on the real stick from 3 m: focus visible, nothing under 24 px, Hindi and Tamil lines not clipped.
