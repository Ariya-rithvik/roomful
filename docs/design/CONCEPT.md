# Concept: one product, not a feature list

Status: design proposal, 2026-10-17. Nothing in this file changes code. Mockups: `mockups.html`. Visual system: `DESIGN.md`.

## The problem with the current UI

The home screen says "live captions, real things brought into the TV, and the evening's happy moments", then offers seven buttons. A judge sees a toolbox. Nothing on screen says why these things belong together, and the most moving part (Dadi following the conversation again) gets the same weight as a news ticker.

## Name

| Option | For | Against |
|---|---|---|
| **Roomful** (recommended) | Describes the result: the TV fills up with the people in the room (their words, their things, their smiles). Keeps the "room" vocabulary already used in the code, the protocol and the UI (room code, "join the room"). One plain English word, easy to say in Hindi and Tamil homes. | A small 3D social app called "Roomful Studio" exists (different category). Fine for a hackathon; run a trademark check before any launch. |
| Tablecast | Says the mechanic in one word: the family table, cast to the TV. | "Cast" sounds like a screen-mirroring feature, and on a Fire TV it points at someone else's product vocabulary. Slightly technical. |
| Roomcaption (keep) | Honest, already on the repo and in the friction log, and the accessibility story is the strongest one we have. | It promises captions only, so "bring it into the TV", the family break and Table Hunt look bolted on. That is exactly why the idea feels unclear. |

Considered and dropped: *Saath* ("together" in Hindi; lovely, but it leaves out the Tamil families we support), *Hearth* (an existing family-display brand), *Family Channel* (real TV channel names).

**Recommendation: Roomful.** Rename display strings only (TV title, phone page title, Devpost). Keep folder, package and protocol names (`@roomcaption/*`) so nothing breaks a week before the deadline.

## One-line pitch

**Roomful puts the people in the room on the TV: what they say in big captions, what they hold up, and the moments they smile, so nobody at the table gets left out, least of all the grandparent who can't hear well.**

Tagline for the end card and the home screen: *Everyone at the table, on the TV.*

## The single story

A TV usually pulls a family apart: the kids watch cartoons, the adults watch the news, and Dadi, who is losing her hearing, sits in the middle following none of it. Roomful turns the TV around so it shows the family to itself.

Every phone in the room is a way onto the TV, and there are exactly three ways in:

| Way in (phone tab) | What the family does | What appears on the TV |
|---|---|---|
| **Talk** | Talks normally, phone on the table | Their words in large captions with their name and colour, in English, Hindi or Tamil. Dadi can answer from the reply board with the remote. |
| **Show** | Holds a real thing up to the phone camera | The photo of that actual teddy, cup or book pops up big ("Anu brought a teddy bear into the TV!") and joins tonight's shelf. Table Hunt is the game version. |
| **Smile** | Leaves Moments on | When the kids show ends, the TV plays the evening's smiles in a short family break, with what was said at that moment. |

The kids channel and the headlines are not the product. They are what the TV was already doing; Roomful weaves the family into it. That framing removes the "why is there a news reader in a captions app" question.

Rename the phone tabs from Talk / Scan / Moments to **Talk / Show / Smile**. The three words are the whole pitch, and they map one-to-one to existing code (`App.tsx` talk tab, `HuntPanel`, `MomentsPanel`).

## What to emphasise and what to tuck away

**Lead with (the spine, on screen in the first 30 seconds):**
1. QR join: one scan, no install, a person appears on the TV with their name and colour.
2. Living room with Table talk captions next to the kids channel. This is the home screen in spirit; make it the main button.
3. Object arrival: the single best "wow" moment, and the only one a judge understands in one second.
4. Family break: the emotional payoff that closes the loop.

**Support (show in the 3-minute video, not in the first impression):** the reply board (strong accessibility depth, give it 10 seconds of its own), big captions full screen (the elder mode), Table Hunt (energy, 5 seconds), "Alexa, pause" on the kids channel (Fire TV integration point for the judges).

**Tuck away in the UI:**
- Headlines: last tab of the right panel, never the default once someone has joined. Default to Table talk.
- Settings, New room and the server address: move into Settings. The server URL on the home footer reads like a debug screen.
- The separate Happy moments screen: it is the same reel as the Moments tab and the family break; keep the route but drop it from the home screen.
- The measurement wording ("timing numbers only") stays on the phone consent card, not on the TV.

## 30-second first impression (hackathon video)

Shoot only what runs on the real stick that day. If a beat is not proven (for example smile capture on a real phone), swap it for the real fallback (OK on the remote saves a moment). Never stage it.

| Time | Picture | Sound / on-screen text |
|---|---|---|
| 0:00-0:03 | Family dinner, wide shot. Dadi smiles politely; she is not following. | Overlapping table talk. Text: "Dadi can't follow the table any more." |
| 0:03-0:07 | TV shows Roomful home: big QR, room code K7QM, six seats. Ravi points his phone camera; his seat fills (sky-blue R, "Ravi joined"). Meena and Anu follow, fast cuts. | Text: "Every phone joins in one scan. No app to install." |
| 0:07-0:13 | Living room screen: the kids show plays on the left. On the right, Ravi's line appears big: "Dadi, the dal is ready, should I bring rice too?" Dadi reads it, nods, answers in Hindi; her line appears in Devanagari. | Text: "What everyone says, big enough to read from the sofa." |
| 0:13-0:19 | Anu holds her teddy up to Meena's phone: "Is this a teddy bear?" Yes. Hard cut to the TV: the teddy's photo pops up on a cream card, "Anu brought a teddy bear into the TV!", then slides onto the shelf. Dadi laughs. | Sound: the arrival chime. No text needed. |
| 0:19-0:24 | The kids show ends. "Family break" card, then the 4-second silent clip of Dadi laughing a minute ago, with the caption of what was said. | Text: "When the show ends, the TV plays tonight's smiles." |
| 0:24-0:27 | Table Hunt: "Find something soft" in huge letters; "Anu found it!" with a +1. | Kids cheering. |
| 0:27-0:30 | End card: Roomful mark and "Everyone at the table, on the TV." Small: "Fire TV app + any phone browser". | Quiet. |

What the judge should be able to say afterwards in one sentence: "It's a Fire TV app that puts the family on the screen, so the grandmother who can't hear can follow and join in."
