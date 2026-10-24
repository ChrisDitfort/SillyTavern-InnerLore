# InnerLore — Living Characters & World

InnerLore is a SillyTavern client extension backed by its bundled `innerlore-storage` server plugin (pure SQLite) for five related jobs:

1. **Private character minds:** each relevant NPC has a durable Persistent Self, an individual textual voice, multidimensional subjective relationships, and one replaceable Current Mind for the immediate scene.
2. **Automatic living lore:** individually significant characters, locations, items, factions, organizations, creatures, events, and concepts become detailed native World Info entries and continue updating as the story changes.
3. **World progression:** a private chronologist infers elapsed fictional time from completed player/story exchanges and advances durable goals, processes, deadlines, and restrained story beats.
4. **Editor-authored events:** reusable per-chat events watch story time and completed player or NPC actions, progress privately off screen, and become visible only under their configured reveal rules.
5. **Game system:** a ledger of money, belongings, object whereabouts, prices, relationships, and reputation, kept from each reply, and a scene planner that prepares people, objects, and prices before the story reaches a place.

It is designed for arbitrary character cards and genres. No scenario, relationship, setting, or canon fact is hard-coded.

## Installation

**Requirements**

- SillyTavern 1.13+ (tested on 1.13.x)
- Any chat-completion API connection (OpenAI-compatible, OpenRouter, z.ai, etc.) — one profile for the story model, and optionally a second, cheaper profile for background analysis

**State storage:** the bundled **`innerlore-storage`** server plugin keeps everything in pure SQLite (see install step 2) — this is the default and recommended mode. An *Embedded* fallback (state inside the chat file) is available in **InnerLore → State storage** for zero-plugin setups.

## Installation

**Step 1 — install the extension** (SillyTavern UI):

Extensions → Install extension → paste `https://github.com/ChrisDitfort/SillyTavern-InnerLore` → reload.

**Step 2 — run the setup script** from the downloaded extension folder:

```
node setup.cjs
```

(Or from anywhere: `node setup.cjs /path/to/SillyTavern`. The older `node setup.js` still works too — it forwards here.)

It works on Linux, macOS, and Windows, needs only the Node.js SillyTavern already requires, and does everything else automatically: links the bundled SQLite plugin into `plugins/`, enables server plugins in `config.yaml` (backup kept), and — if SillyTavern is running — **restarts it for you** and waits until the storage plugin is healthy. If SillyTavern is not running, the script says so and you simply start it as usual.

**Step 3** — check the **InnerLore** panel in Extensions: pick a background-model connection profile and press **Test Connection**. That's it — open any character chat and the first analysis pass builds lore and minds automatically after the next story reply (or press **Scan New Turns**).

All state — entities, minds, progression, narrative history — lives in a single SQLite database at `data/worlds/innerlore-storage.db` with per-save revision history (last 20 per chat). No chat-JSONL state, no external services.

The narrator prompt, narration length (Brief / Standard / Long), context budgets, history handling, and event behavior are all configured from the InnerLore panel — no prompt-manager editing required.

## Inspiration and architecture

The concept is inspired by LewdLeah's MIT-licensed [Inner Self](https://github.com/LewdLeah/Inner-Self) and [Auto-Cards](https://github.com/LewdLeah/Auto-Cards) for AI Dungeon. InnerLore is an independent SillyTavern implementation rather than a port of AI Dungeon's hook protocol.

AI Dungeon's scripts ask the story model to emit maintenance syntax inside the normal generation and then parse it. InnerLore instead:

- runs a separate background model request after a story reply;
- requests a separately validated maintenance patch, using the line-oriented InnerLore DSL v1 by default or strict JSON as the compatibility fallback;
- merges additions locally so an omitted fact cannot disappear;
- requires explicit resolution/removal operations before established list facts are deleted;
- commits complete per-chat state to authoritative SQLite, with normalized brain/search tables and a rebuildable LadybugDB graph;
- incrementally projects field-level, branch-aware context fragments with visibility, certainty, importance, provenance, and durable event-delivery receipts;
- asks the server to prepare one bounded NarrativeState packet before generation, with a deterministic local compiler as the timeout fallback;
- exposes that already-prepared packet through synchronous SillyTavern macros, so custom prompts never perform database or network work during expansion;
- retains only a small storage-world pointer in SillyTavern chat metadata;
- mirrors public world records into an extension-owned native World Info book;
- deterministically scans and injects only relevant records, without consuming the single chat-lorebook assignment or making another model call before every story reply;
- preserves manual edits as protected overrides;
- rebuilds state after edited, swiped, or deleted messages so discarded branches do not remain canon;
- gives a reswipe a conservative pre-response mind view instead of an empty prompt, strips psychology first learned in the discarded reply, and waits to persist the clean rebuild until the replacement arrives;
- detects strong mid-sentence stream cutoffs and appends an exact continuation without replacing the saved reply;
- places a scenario-independent latest-turn contract beside generation, preserving player/NPC action ownership, explicit user choice sets, and completion requirements against stale history;
- keeps uncertain story time as minimum/estimated/maximum ranges and schedules deadlines deterministically;
- evaluates editor-authored time/action triggers deterministically while requiring the progression agent to acknowledge every eligible definition with evidence-grounded, actor- and message-range-checked semantic matches;
- previews explicit completed time advances at the message-send boundary, and optionally previews a concrete player action attempt, so an eligible event can affect that same story reply without waiting for background analysis;
- latches every observable editor event into a separate mandatory delivery block, records which foreground generation received it, verifies the completed narration, and retries a bounded number of times until delivery is established;
- stores simulated off-screen events outside public lore until the narration actually reveals them;
- compiles a deterministic current-scene map and injects only scene-relevant minds, lore, open threads, and progression without another model call;
- stores stable location layout and placement claims as keyed spatial invariants, then computes branch-aware changes when a scene returns to the same place;
- requires emotionally consequential direct thought to add character-specific psychological content rather than merely italicizing or paraphrasing the newest event;
- seeds one compact card-backed personal anchor when evidence supports it, then promotes the selected identity, thought form, spoken form, and emphasis policy beside the newest turn so literal prose cannot collapse back into a generic archetype;
- derives a branch-local cooldown from the last three visible story replies, rotates away from already-spent identity anchors, and suppresses repeated Current Mind phrasing without storing a second memory ledger or cooling the underlying emotion;
- versions that card-backed expression foundation separately from the metadata envelope, and uses a hard card-driven expression contract while any required upgrade rebuild is pending instead of placing a background provider call on SillyTavern's generation boundary;
- allocates context by relevance, suppresses near-duplicate claims across layers, expires stale scene emotions from active context, and clips only at sentence or word boundaries;

## First use

1. Install the bundled `innerlore-storage` plugin (see Installation above) and set `enableServerPlugins: true` in `config.yaml`.
2. Reload SillyTavern after installing the extension. The first load of each legacy chat commits its complete old metadata state to SQLite before replacing it with a small pointer.
3. Open **Extensions → InnerLore**.
4. Under **Background Model**, confirm the desired Connection Profile. On first load, InnerLore adopts Summaryception's selected profile when it exists; the current configured profile is `OpenRouterDeepseekV4Pro0813Think`.
5. Use **Test Connection**.
6. Under **World Progression Engine**, keep the Conservative and Balanced defaults or choose a different autonomy and time-inference mode. Its profile defaults to the selected InnerLore background profile and can be tested separately.
7. Optionally use **Triggerable Event Editor** to define events for the current chat. **Create Draft** only records its name; names are not parsed for instructions. Configure a time or action trigger, choose whether a player action waits for completed narration or is conditionally considered in that same reply, check **Enable and arm when saved**, then press **Save & Arm Event**.
8. For a new story, simply play. The default runs after every assistant reply.
9. For an existing story, use **Rebuild From Chat** once to seed its minds, lore, and story clock from the full conversation. Ordinary progression upgrades begin with the next reply instead of silently launching a large historical backfill. An outdated expression foundation is now warmed eagerly in the background and persisted independently from objective continuity. If a reswipe arrives while that real, branch-safe curator pass is running, it reuses the same request instead of aborting and restarting it. The narrator is called only after the foundation succeeds; provider failure cancels and restores the swipe with a visible error instead of silently falling back to the raw card. Larger non-swipe history changes still clearly request or run a full rebuild.
10. To place context yourself, set **Context delivery** to **Prompt macro only** and add `{{innerlore_state_context}}` to the desired main prompt. Leave the default **Automatic system prompt** selected when no macro is present.

## Background response formats

**InnerLore DSL v1** is the default and recommended mode. It is a line-oriented transport intended to reduce braces, commas, quoting, and array-index mistakes in long curator, progression, and Event Director responses. A typical record begins with `LOCATION Ben Tavern`, contains `field = value`, `facts += value`, and nested `ITEM spatial.set` blocks, then closes with `END`; the document closes with `DONE`. **Strict JSON** remains selectable as the compatibility fallback for providers that cannot follow the DSL contract.

Four paired 30-turn replays (identical transcript, model, and prose; only the transport varied) measured DSL against strict JSON on GLM 5.3: with the EVALUATION-first contract, DSL needed 40% fewer repair calls (6 vs 10 across three clean runs, with zero rejected repairs), ~31% fewer completion tokens, and ~22% less aggregate model time, at equal NPC-mind coverage. Existing installations that explicitly saved `json` keep their choice; the format is switchable any time under **InnerLore → Background analysis response format**.

The DSL middleware parses into the exact same canonical objects used by JSON mode. The existing domain validators still reject missing evidence, omitted trigger acknowledgements, unsafe paths, unsupported fields, and invalid canon operations. A bounded set of lossless structural variations is normalized locally and recorded for diagnostics. When a different background model proves unreliable with DSL, switch that chat or setup to strict JSON.

DSL responses are also recovered instead of discarded whenever recovery cannot invent meaning: a document that is complete except for its final `DONE` marker is accepted as-is, a length-truncated document is salvaged to its complete records with the dropped tail counted in diagnostics, a provider that answers a DSL request in JSON is accepted through the same validators, conflicting duplicate field assignments follow JSON's last-wins semantics, and an Event Director proposal that writes the invalid visibility `public` is coerced to the equivalent `observable` enum. A repair retry still runs for genuinely malformed output, and when the failure looked like a length cut the retry carries a larger response-token budget so it cannot truncate identically. Every salvage, cross-format acceptance, coercion, and normalization is reported in the per-run summary and stored in the chat's `lastRunStats` codec block.

## Server persistence and queries

All state lives in a single SQLite database at `data/worlds/innerlore-storage.db`, owned by the bundled `innerlore-storage` plugin. Every save stores the complete lossless snapshot for the chat's world plus a bounded revision history (the last 20 revisions per world), with optimistic-revision concurrency so concurrent tabs cannot silently overwrite each other. Worlds are keyed by a deterministic hash of the chat id, and chat renames/branches fork cleanly.

The plugin exposes authenticated routes under `/api/plugins/innerlore-storage/v1/worlds/:worldId/...` for health, world creation, snapshot load/save, forks, renames, deletion, and context profiles. Prompt context itself is compiled client-side by the extension's deterministic compiler — the plugin is pure persistence, which keeps it dependency-free (Node built-ins only).

> **Legacy:** installs that predate the bundled plugin may still use the heavier `airpg-storage` engine (FTS5 search, graph projections, server-prepared contexts); existing chats on it keep working automatically. New installs do not need it.

The story model and background model are independent. The current configuration uses OpenRouter DeepSeek V4 Pro 0813 Thinking for prose, InnerLore, and World Progression. SummarySception may retain its separate MiMo 2.5 Pro Thinking summarizer profile.

## Generated lorebook

Each chat receives a book named like:

`InnerLore - Character Name - 1a2b3c4d`

The book contains ordinary editable World Info entries. InnerLore does not assign it as the chat lorebook or select it globally; it performs its own relevance scan and prompt injection. This avoids replacing an existing chat lorebook and prevents generated canon from leaking into unrelated chats.

Use **Open Lorebook** to inspect entries in SillyTavern's native editor. If entry content is edited there, InnerLore detects the changed content during its next synchronization and protects it as a manual override. The extension's **Lore Entry Editor** can also save or release overrides directly.

## Derived context budget (always on)

The context engine sizes every story generation's curated packet from the real context, not fixed numbers. Fixed costs are measured first - the narrator prompt instructions with the state macro empty, the user persona, the character card, and the opening message - and subtracted from the model's context limit together with a configurable safety margin (default 10%, room for World Info and prompt inserts). Everything left is the gross, split by configurable shares across **response, history, scene, minds, lore, progression, and game** (defaults 10/37/5/20/15/8/5). History and response are shares of the same pie, not separate reservations.

History rides inside the state macro as part of the packet, and SillyTavern's own rendered conversation turns are bypassed for story generations (system prompt entries and the live player turn always remain), so history ships exactly once - no double-up, no wasted tokens. Every story generation - send, continue, swipe, regenerate - receives the complete packet, and the compiled packet can never exceed its derived allowance: sections that overflow are recompiled with proportionally shrunken budgets, with progression dropped only as a last resort.

There is no off switch; only the shares, the safety margin, and the history turn cap are configurable, from the InnerLore panel's context section.

## Text-completion story models (NovelAI Erato and Kayra)

When SillyTavern's story API is a text-completion one (NovelAI, KoboldAI, text-generation-webui), InnerLore switches its story context to the form those models read. Erato and Kayra continue prose rather than follow instructions; they have 8,192 tokens of context and write at most 250 tokens per request. The tagged packet and turn contract written for chat models would take most of that window and push the story's own recent turns out.

- **Memory** (after the story string): a short `----` lore entry for each person present, with what they notice, feel and want and a line of their private thought, then the place and the other selected lore.
- **Note** (wherever `{{innerlore_state_context}}` sits, usually the Author's Note, or at the injection depth in automatic delivery): bracketed lines for where and when, who is here, the ways on, the purse and belongings, prices, how people regard the player, recent changes, the material prepared for this place, and one line saying the player's words and choices are the player's own.
- **Budget:** memory and note together take about 30% of the model's context (about 8,600 characters at 8,000 tokens). SillyTavern fills the rest with the newest turns.
- **No chat-only parts:** the latest-turn contract, the narrator prompt swap and the response-length warning are skipped. The choice buttons under a reply are built from the camera instead of a choices block.
- **Request budgets:** NovelAI serves one generation per account, and Featherless's plan has 4 concurrency units, with a model costing 1 (under 16B), 2 (under 35B, such as Gemma 4 31B) or 4 (70B and larger; a name without a size counts as 4). Both refuse more with 429. InnerLore's requests through these providers share the budget, and the time spent waiting does not count toward a request's timeout. When the story runs on the same provider, background requests keep the story's share free (with a 2-unit story and 2-unit background on Featherless, one background request runs at a time and the story never waits); when both cannot fit (NovelAI, or a 4-unit Featherless story), a background request waits for the story and the story waits for one already running. Background passes through other providers run alongside as usual.

The background passes keep their own connection profiles, so every InnerLore feature still runs whatever writes the story. Erato and Kayra cannot run the passes themselves: the curator and World Progression prompts are larger than their whole context, and the passes' answers are longer than one request allows.

## NanoGPT (subscription)

Connections to `https://nano-gpt.com/api/subscription/v1` count as a provider with a budget of ten requests at once, like Featherless's four units and NovelAI's one: background passes share it with the story and keep the story's slot free. GLM 5.3 models there cannot stop thinking, so story requests to them carry `reasoning_effort: low` unless the connection's own body says otherwise; other NanoGPT models are sent as they are. Model sizes that are not in the name (`z-ai/glm-5.3-flash-uncensored`) count as large, so the assisted hints for small models stay off for them.

## World independence

Every chat owns a world of its own, keyed deterministically to the chat id. New worlds are strictly independent of old worlds: a brand-new chat (greeting-only) never inherits InnerLore state from the chat it was started from - SillyTavern's cloned chat metadata is stripped of the previous world's pointer at load, so nothing can fork, reuse, or compare against it. The chat then creates its own world and card-seeds it. Genuine branches - ST's branch/checkpoint feature and swipes, which clone the full message history - still fork the source world by design. A save that would shrink a world below 70% of its committed entity count is blocked and the server state reloaded, so a stale snapshot in any tab cannot silently destroy a seeded world.

## Card-declared seed entities

A character card can pre-populate a brand-new chat's world with canon entities — its locations, most usefully — instead of waiting for the curator to meet each place in play. Declare them on the card at `data.extensions.inner_lore_seed` (or `extensions.inner_lore_seed` for v1-style cards) as either an array or `{ "entities": [...] }`:

```json
{
  "entities": [
    {
      "type": "location",
      "name": "Vigil Cross",
      "aliases": ["the ley crossing"],
      "importance": 80,
      "summary": "A free city at the crossing of two great ley lines.",
      "description": "Warden walls hold a fragile peace between emissaries of every court."
    }
  ]
}
```

Seeds are applied once, when a chat with no existing InnerLore world gets its store created — new chats and first loads. Existing chats, branches, and legacy stores are never retro-seeded. Seeds become ordinary entity records: the curator enriches them as play actually reaches each place, and entity types disabled in settings are respected. Entries without a summary or description are ignored, and at most 120 seeds are honored per card.

## NPC whereabouts and the world map

The curator records where every character and creature is with `current_location`, reusing a canonical location name and updating it whenever someone arrives, leaves, or follows the player. A place named as a recorded part of a known location (a garden or fountain in a house's spatial record) anchors to that location. Without an explicit claim, a replaced `current_state` whose opening clause names a known place ("At the fish market on the Old Quay, …") moves the record there; a place named later in the state, or only seen ("handed Jet the key to Room Two", "smoke rising behind the Salt Lantern"), does not. Omission never clears a location; `unknown` does.

The HUD, the world map, and the scene view all place NPCs from that record. Until the curator has processed the newest reply, an NPC the scene compiler finds present in it stands at the scene's location, so the map moves the moment a reply lands. Summaries and history never place anyone. A place reached in play before it has a location record gets a provisional map node, and when the newest turn names no place, the scene settles where the present cast is recorded to be. A place named inside a longer known place name ("Highmarket" in "Highmarket Gate") is not counted as named, so the scene settles on the specific place.

**The HUD** sits under SillyTavern's top bar, placed at the top bar's real bottom edge for any theme or screen. Its top row has:
- **Place and story time:** tap them to open the map around you.
- **You:** tap your own face to open the drawer.
- **Buttons:** the world map, and an expand button for the drawer.

**Cast cards** form a second row: everyone in the scene, then people seen recently (dimmed), each with their portrait, name, what they are (the planner's role, or the start of the curator's summary) and how they regard you. The row scrolls sideways. Tap a card to open that person's page with their private mind. With cast cards turned off, small faces of the same people sit in the top row instead.

**Portraits** are drawn for the people on the cards by an image server with the Stable Diffusion WebUI API, by default the one set in SillyTavern's Image Generation (Local Dream through LDBridge, for example). The game ledger's model turns what the story says about the person (the curator's summary and description, the planner's role and appearance, and the place they are in) into Danbooru-style tags, which suit Illustrious and other anime SDXL models. The prompt is cut to the 75 tokens the model reads. Portraits are drawn one at a time (Local Dream takes about 90 seconds each), only once the story has described someone, and are kept as small WebP files under SillyTavern's user images (`InnerLore/`), named for the chat that drew them: deleting the chat deletes its portraits, a branch or a renamed chat gets its own copies of the faces it inherits, and files whose chat no longer exists are removed when SillyTavern starts. They show on the cards, in the drawer and on the person's page, where **Draw a new portrait** replaces one you don't like. A failed portrait is retried after ten minutes; an image server that doesn't answer pauses drawing for ten minutes. Settings are under **Portraits and Cast Cards**: both switches, the image server, style tags, negative prompt, steps and guidance.

**The game menu** is a bar along the bottom of the screen, under the message box. Each item opens its own full screen: **Inventory** and **Trade**. The bar steps aside while the on-screen keyboard is up.

**Trade** lists who you can deal with here: the people in the scene and anyone selling at this place, with their wares, prices, services and (when known) the coin they carry, beside your own things. It also lists any bodies here, with what can be seen on them. Buttons write your move into the message box (buy, ask a price, sell, offer a swap, take from a body, search it), so the story narrates the deal and the ledger records what actually changes hands.

**The drawer** lists who is with you and what each person is doing, plus the explored places around you, with shortcuts into the map. Whether it is open is remembered per browser.

**The map** opens on the region you have explored, with you in view:
- **Moving:** one finger pans and two fingers pinch-zoom around their midpoint. The wheel zooms around the cursor, double-click zooms in, and the buttons zoom around the centre or re-centre on you.
- **Readable at any zoom:** markers and labels keep their screen size, so crowded places spread apart as you zoom in.
- **Places:** tap one for a details sheet with what is known and who is there.
- **Elsewhere:** people at unknown or unexplored places are listed here instead of on the map.
- **Here view:** shows the current place, the place containing it, and the explored places inside it.

**Fog of war:** unexplored areas stay hidden. A place is explored once a reply puts you there (by naming it or by explicit movement), when it is the current scene, or when the curator records you there; the places containing it count as explored too. Exploration is worked out from the chat itself, so swipes, edits and rebuilds never leave a stale record. Fog lifts in a circle around each explored place. Places inside that circle are shown as seen but not yet visited, and everything else stays hidden until you get there.

## Game system

InnerLore keeps a game ledger alongside the lore: money, possessions and where every tracked object is, prices, how individual people regard the player, the player's reputation with groups, and places the scene planner has prepared. All of it reaches the narrator in `{{innerlore_state_context}}` (right after the camera block) and alone in `{{innerlore_game_context}}`, and **Inventory** in the game menu at the bottom of the screen opens it for the player as a full screen (Bag, Here, People, Ledger).

**Game ledger.** After every reply a background pass reads the new exchange and records what it changed:
- **Belongings and objects:** what the player picks up, buys, sells, gives, drops, uses up, or breaks; notable objects other people move, hide, or hand over. Each object has a holder (the player, a person, a place, or a container such as a satchel), a spot ("on the shelf behind the bar"), quantity, value, condition, an optional price and seller, and the history of its moves. Giving part of a stack splits it.
- **Money:** the world's own currency (established once, for example crown 240, shilling 12, penny 1), the purse, and every payment, purchase, wage, tip, theft, or find that reaches or leaves the player. A payment larger than a counted purse empties it and is reported. Other people carry their own coin too, and money passing between them (a customer paying a stallholder, a bribe) is recorded.
- **Trades:** sales and swaps between anyone, the player included, as the story narrates them.
- **Deaths and loot:** when the story shows someone dying, their body stays where they fell and keeps everything they carried, including their coin. The narrator sees what is on the body (things they hid are marked hidden until searched), and whatever the story shows being taken moves to the taker.
- **Prices:** every price the story states for goods and services at a place. A near-duplicate ("ale" and "a tankard of ale") is the same price.
- **Relationships:** how each person regards the player, from -100 to 100, changed by what the player does to or for them (a courtesy moves a point or two, a betrayal up to 25 at once), with the reason kept. Tiers read hostile, unfriendly, wary, neutral, warm, friendly, close.
- **Reputation:** the same scale for groups, organizations, and a place's people, changed by public deeds.

The ledger records only what the story establishes, never intentions or offers. Its state is an append-only journal of changes, each tagged with the message it came from, so a swipe, an edit, or a rebuild rewinds it exactly: a reswipe never sees a purchase from the reply it replaces.

**Scene planner** (part of the planning module). The planner prepares places like a game master: who is there now (named people with a role, appearance, manner, a want, an optional secret, the group whose view of the player they share, a personal lean, the coin they carry, the things they carry (some hidden), and what they sell), notable objects with honest values and where they are (some hidden until searched for), prices for goods and services consistent with the world's economy, and hooks. A prepared person's first impression is their group's reputation at the moment they enter the story plus their lean: a fisherman's view starts from what the quay's fishermen think of the player, warmer for a trusting soul and cooler for a bitter one. A person with no group starts at their lean. The narrator sees that attitude while the person is still only prepared, so their first lines already show it. Someone the narrator invents on the spot is treated the same way: when they first appear, the ledger records their group and a lean read from how the passage shows them, and they start from the group's view too.

It runs:
- after replies, for where the player is when it has nothing prepared (or the preparation is stale in story time), and for places reachable from there;
- when the player sends a turn that heads somewhere unprepared, or stays somewhere that was never prepared. The story then waits for it (up to the configured time), so the narrator describes the arrival with the planner's people, objects, and prices;
- once at the start of a chat, to give the player a modest starting purse and belongings consistent with the card and persona.

Prepared material is narrator-only: it is listed under "Prepared for …" in the game block, introduced when the scene calls for it, and becomes part of the world when a reply shows it. Nothing prepared is canon until then, and the inventory screen never shows it. Known people are never re-created; the curator keeps tracking where they are.

Settings are under **Game System**: the ledger and planner switches, their profiles (by default the ledger follows the curator profile and the planner the progression profile), how many places to prepare per reply, when a preparation goes stale, the longest wait for a destination, the game block budget, and extra instructions for each pass.

## Private conversations: a quiet word, a text, or mind to mind

A person's page (tap them in the HUD or a cast card) offers three ways to talk apart from the narration, and the **Phone** item in the menu bar lists every conversation, who can be reached and how, and the contacts you hold.

- **Private chat** is a quiet word with someone who is here with you (the camera frame's "with you" list decides). Their spoken lines come back as plain dialogue with at most a short beat.
- **Text** sends a message on the world's device to someone whose number or contact you have. Numbers are given in the story (the ledger records them) or in a conversation itself (a number someone texts you is added to your contacts at once).
- **Mind** reaches someone mind to mind when you have the gift. A person with a gift of their own can feel the touch and shut you out; the thread closes until the story moves on.

The first time you reach for a mind or a phone, the **ability judge** (the ledger's model) reads the character card, your persona, the person's lore and the recent story and settles it: your level of mind-speech, whether the person has a gift or a warded mind, whether a message device exists in this world, and which contacts the story has already handed you. The verdict is written into the game journal like any change (`ability.set`, `device.set`, `contact.add`), so a swipe or rebuild rewinds it, and the ledger updates it when the story grants or takes a gift, a number or a device (new ledger records ABILITY, CONTACT and DEVICE). Levels run 0-100: a gift is usable from 20 (novice), adept from 40, expert from 70, master from 90; below 20 it is latent. Gifts show on the person's page, under Gifts and skills in the inventory, and in the narrator packet (`Jet's gifts: …`, `Gifts of people here: …`, `Jet's phone: can reach …`).

The person answers through the story's own connection: a short, in-character reply (one to three bubbles) from a prompt that carries their lore, their private mind, how they regard you, where they are and the last few story turns. On the fork's shell the request streams through the active connection (NovelAI's chat endpoint needs streaming); a text-completion story (Erato, Kayra) gets a transcript prompt instead. Only you type as your character; the person's words are theirs.

When you close the conversation (Done, or back to the story), the story is told: one message per conversation, from that person, holding the transcript as plain `Name: line` text under a bracketed header, shown in the story log as a card of bubbles. The narrator, the curator and the ledger read it like any reply; the scene derivation leaves it alone, so texting someone does not put them in the room. Threads live in the chat's metadata (`innerlore_threads`) and travel with branches.

Settings: Private Chat, Phone and Mind (on/off, reply temperature and length, extra instructions for private replies). Test hooks for the fork's UI harness live on `window.InnerLore.test` (stubbed replier and judge, threads, clean-up).

## Private minds

Each NPC brain separates durable identity from the present reaction:

- **Persistent Self** stores compact first-person self-concepts, values, worldview, fears, insecurities, desires, emotional needs, contradictions, biases, beliefs, opinions, goals, tendencies, secrets, psychologically significant memories, and an optional concrete personal anchor such as a formative association, coping ritual, symbolic object, or idiosyncratic priority. The anchor is relevance-selected rather than forced into every reply.
- **Voice** stores stable tendencies in vocabulary, formality, cadence, humour, sarcasm, profanity, hesitation, openness, private thought style, avoidance, language under pressure, and individually supported emphasis through case, punctuation, repetition, interruption, or fragmentation. These are not forced catchphrases or mechanical emotion styles.
- **Relationships** store qualitative, subjective aspects such as trust, affection, respect, fear, resentment, attraction, dependency, expectations, conflicts, and significant shared experiences. Contradictory aspects can coexist.
- **Current Mind** is one replaceable scene snapshot: perception, interpretation, emotion and intensity, attention, expectations, immediate goal, relevant memory keys, raw inner thoughts, impulse, restraint, conflict, and intention.

Example editor state:

```json
{
  "persistent_self": {
    "self_reliance": {
      "kind": "self_concept",
      "statement": "I don't need anyone to rescue me.",
      "confidence": "confirmed"
    },
    "intimacy_conflict": {
      "kind": "contradiction",
      "statement": "I crave closeness, then punish myself for needing it.",
      "confidence": "inferred"
    }
  },
  "voice": {
    "guarded_cadence": {
      "kind": "cadence",
      "statement": "I speak in clipped, deliberate sentences when exposed.",
      "confidence": "inferred"
    }
  },
  "relationships": {
    "Daniel": {
      "aliases": [],
      "aspects": {
        "earned_reliance": {
          "kind": "trust",
          "statement": "I can depend on Daniel when things become serious.",
          "confidence": "confirmed"
        }
      }
    }
  },
  "current_mind": {
    "interpretation": "Daniel has finally had enough of me.",
    "emotions": [{ "name": "fear", "intensity": "high", "cause": "He is leaving." }],
    "innerThoughts": ["Stop him."],
    "impulse": "Call him back.",
    "restraint": "I refuse to let him hear me beg.",
    "intention": "Delay him without admitting I need him."
  }
}
```

The curator reuses stable keys, consolidates significant experiences into beliefs or relationship changes, and explicitly deletes obsolete or redundant memories. Momentary reactions replace Current Mind instead of accumulating as permanent prose. InnerLore injects only psychology relevant to the current scene. The narration model receives the conceptual flow `world event → perception → interpretation → emotion → thought → impulse/restraint/conflict → intention → expression`, while retaining responsibility for nuanced human interpretation.

The injection states that:

- private state is narrator-only guidance;
- characters know only their own thoughts and story-established knowledge;
- inferred thoughts are not public canon;
- a selected, fresh Current Mind grants close narrative access to that NPC unless the established story explicitly forbids it;
- an emotionally active focal NPC receives a natural braid of observable behaviour, one to three short literal private-thought beats, and spoken expression when they speak; neutral or offscreen beats are not forced into that pattern;
- inner thought can differ sharply from spoken dialogue;
- personality, relationship history, intensity, restraint, and circumstances naturally shape literal sentence construction, lower-case or selective capital stress, punctuation, repetition, fragments, interruption, humour, profanity, silence, and behaviour, but never through a deterministic emotion-to-style rule;
- high-stakes focal reactions cannot satisfy the expression layer with uniformly polished neutral prose: multiple character-supported surface choices must carry the pressure, while controlled characters may keep a restrained public surface if their private syntax makes its cost visible;
- when the retrieved individual emphasis policy permits case stress and Current Mind establishes pressure, the final turn contract requires sparse selective capital stress plus another supported surface device; it never derives typography from an emotion score alone;
- a dynamically selected private lens contributes fresh literal content anchors to private thought, while thought and spoken-form gates prevent a generic self-command or token stammer followed by polished dialogue from satisfying personality expression;
- the last three story replies act as negative surface evidence: a recurring gesture, prop interaction, gaze beat, metaphor, self-command, stammer scaffold, or conspicuous phrase must give way to another character-compatible realization unless a new trigger escalates, changes, or pays off that callback;
- the model should literalize the focal mind rather than replace it with explanatory phrases such as “she felt” or “he wondered,” while treating stored thoughts as evidence to update rather than lines to copy;
- the model should perform personality through choices, subtext, body language, thought, and distinctive dialogue rather than explain a trait list;
- the model must not decide the player's unspoken thoughts or actions.

On the first useful curator pass, explicit card evidence can seed one concrete personal anchor, a compact thought style, the best-supported cadence, hesitation, openness, or pressure response, and a flexible private/public emphasis policy. The curator also distinguishes outward compliance from willing private acceptance: calm speech or a spoken “yes” under threat, hierarchy, dependency, fear, or coercion does not erase fear or internal conflict by itself.

The player character is excluded from automatic private-mind creation in code, even if a curator model proposes one.

The **Character Brain Editor** supports direct JSON editing and manually adding a named character.

## Automatic lore patch rules

The background curator outputs patches rather than replacements:

- `facts`, `relationships`, `history`, and `unresolved` add information;
- omission leaves old information untouched;
- `remove_facts`, related removal arrays, and `resolve_threads` are required to delete or resolve old list items;
- `summary`, `description`, and `current_state` replace only when explicitly supplied;
- aliases merge into an existing record without silently renaming its canonical name;
- new entries below the importance threshold are discarded;
- generic nouns, throwaway scenery, undifferentiated one-off people, and common concepts are excluded;
- a consequential or recurring anonymous NPC may use a specific story-established descriptor, but the curator never invents a proper name for them;
- a new story-inferred durable personality facet is staged as a candidate until a second independent passage supports the same claim; card-backed, consolidated, existing, or explicitly confirmed significant-event facets can be admitted immediately;
- subjective beliefs, lies, suspicions, and inferred motives belong to private minds, not public lore.

The default **Detailed** card target is approximately 180–350 words when the passage contains enough evidence. Sparse evidence deliberately produces a shorter card rather than invented padding. Compact and Expansive modes are available.

## Saved state versus active context

InnerLore does not delete established canon merely because it is not useful in the current scene. It separates durable saved state from the small active prompt block:

- exact name, alias, or key mentions activate a record;
- recently seen records remain active for the configured recency window;
- unresolved records remain eligible so open canon is not lost when Author's Notes are not manually maintained;
- pinned records remain active, while disabled records never inject;
- resolved, unmentioned lore and old inactive minds age out of the story-model context but remain saved and can reactivate later;
- a bounded set of the newest low-level SummarySception snippets provides lower-priority retrieval hints, while deep historical summaries do not permanently reactivate obsolete lore;
- crowded retrieval reserves room for relevant locations and items, and divides the shared character budgets fairly so one verbose record cannot consume the whole block.

Selection is deterministic and database-backed. SQLite filters audience visibility before candidate scoring, FTS5 narrows large stores, and exact scene/name matches, recency, importance, and pinning determine the bounded subset. No context-building LLM is called. If the local server misses its short preparation deadline, the existing deterministic compiler supplies the exact branch-keyed fallback for that generation.

SummarySception-hidden assistant messages retain their original story identity for InnerLore fingerprints and rebuilds. SummarySception compresses narrative history, while InnerLore independently retains structured locations, items, unresolved threads, and compartmentalized minds.

## Context Compiler v2

Before each story generation, the local Context Compiler derives a compact scene focus from the newest player/story exchange and already-curated current state. It identifies the current location or directed movement, engaged characters, the newest player-turn source, directly addressed characters, and objects actually in play. This is deterministic prompt compilation, not a third model request and not a new source of canon.

Scene membership, the newest turn, explicit open threads, SummarySception recall, recency, importance, and manual pinning all contribute to retrieval. Current-scene records receive most of the budget. Rejected alternatives, departed characters, distant scheduled beats, and objects elsewhere remain saved but do not enter an unrelated scene merely because their names appeared several messages ago.

Within each selected record, current state and unresolved canon render before overview and historical facts. Budgets are weighted by relevance rather than divided equally, and truncation occurs only at natural language boundaries. Near-duplicate claims are suppressed across entity records and progression concepts. Private minds reserve room for a stable identity facet, individual voice, and fresh Current Mind before lower-priority durable detail. Only relationships involving the active scene are selected. Expired Current Minds stop injecting, while durable psychology remains available for later reactivation.

Location records also carry stable keyed spatial invariants for facts such as room shape, door placement, containment, dimensions, access, contents, and persistent condition. Repeating the same invariant is a no-op instead of a revision. When the active branch returns to a location after leaving it—or explicitly asks what changed—the prepared packet compares the last visit's committed revision with current SQLite truth and supplies a bounded `changesSinceLastSeen` delta alongside the unchanged layout.

The **Context selection inspector** under InnerLore's Advanced settings shows the compiled scene, selected minds with facet/voice/relationship/Current Mind counts, selected lore and progression records, context size, duplicate suppression count, and saved records deliberately omitted from the prompt. This makes context decisions auditable without exposing diagnostic text to the story model.

## Prepared state and prompt macros

The extension computes a branch fingerprint and a compact current-scene observation, then requests a prepared state for the exact `{world, store revision, branch head, profile}` key. The server reads the branch, public lore and locations, spatial invariants and return-visit deltas, narrator-private NPC minds, progression, generic world time/location/lore/event projections, and bounded graph neighbours from one consistent SQLite revision. Hidden trigger definitions are excluded; their mandatory, receipt-backed delivery block remains a separate higher-priority channel.

Macro expansion is synchronous and reads only this precomputed packet. In **Prompt macro only** mode the normal `inner_lore_context` extension prompt is cleared, preventing duplicate weight. Available tags are:

- `{{innerlore_state_context}}` — recommended compact complete state
- `{{innerlore_state_json}}` — structured JSON for prompts that explicitly consume it
- `{{innerlore_scene_context}}`
- `{{innerlore_npc_context}}`
- `{{innerlore_lore_context}}`
- `{{innerlore_progression_context}}`
- `{{innerlore_game_context}}` — the game ledger: purse, belongings, what is here and for sale, standing, reputation, and the planner's prepared material

An old packet is never reused across a revision or branch-head mismatch. The section budgets in InnerLore settings become safe per-request profile overrides; named server profiles remain revisioned in SQLite for reusable configurations.

## World Progression Engine

The progression agent runs after completed story replies. It estimates elapsed time from both the attempted player action and what the narration confirms actually occurred. A walk across a room and a greeting therefore advances seconds even without “later” or “the next morning”; overlapping restatements of the same action count once. New NPC dialogue, pauses, reactions, and consequences in the reply add time. Dialogue turns are sequential by default, while overlap is accepted only with explicit confirmation and evidence. Explicit clocks, waits, travel durations, sleep, montages, and scene cuts take priority over soft action-duration estimates.

The private per-chat state contains:

- an uncertainty-aware elapsed clock and optional story-time labels/anchors;
- NPC, faction, group, and world goals with progress, blockers, next steps, and deadlines;
- ongoing character, location, item, faction, and world processes;
- latent, scheduled, possibly-due, due, off-screen, revealed, and cancelled beats;
- a bounded audit log and an independent processing watermark.

Every supplied triggerable event must come back acknowledged (`EVALUATION <key>` with `evaluated = TRUE`). A missing, duplicate or unknown acknowledgement is settled locally as "not matched" and recorded as a diagnostic (`acknowledgement_filled`, `evaluation_dropped`), on every profile, not only assisted ones: an echo record is never worth a repair call. When a progression response does fail locally, the repair request carries the model's own draft and the validator's message, not the whole source prompt again, as long as the draft is recognizably a progression document (DSL header or JSON with a `time` object); only an unusable answer (prose, a refusal, a cut-off header) is repaired with the full prompt attached.

The deterministic scheduler marks something definitely due only when the clock's minimum has passed the deadline's maximum. Overlapping uncertainty becomes possibly due. Player-required events can never be marked occurred off-screen or revealed by the engine. Off-screen simulation is narrator-only proposal state, not public canon; the ordinary curator adds it to lore only after story prose establishes it.

### Triggerable Event Editor

Triggerable events are authored only in InnerLore's editor; the progression model cannot invent, rename, or overwrite them. **Create Draft** creates a disabled named record—it does not interpret phrases such as “in five minutes” from the name. Each definition can watch an explicitly configured elapsed-time threshold, a completed action, or both using **Any** or **All** matching. Time may be measured from the start of the story or from when the event was saved. Action watches can be restricted to the player, any NPC, or one named actor. A mere intention, hypothetical, refusal, failed attempt, or action attributed to the wrong character does not count as a completed-action match.

Action timing defaults to **After completed narration confirms it**, preserving existing events. For an immediately observable event driven by the player, **Conditionally in the same reply** lets the story model react to a concrete attempt in the newest player message. This path is explicitly conditional: it does not convert an intention or failed attempt into success, and the background evaluator still checks the completed player/story exchange afterward. Because an NPC action is not known before the reply is generated, NPC-only and hidden events continue to use after-outcome timing.

An event moves through explicit runtime states: armed, privately active, observable, revealed, and resolved or cancelled. Hidden active events can advance linked NPC goals and background processes, but both the event and those derived records are omitted from story-model injection until it becomes observable. Reveal delays or conditions make consequences observable; they deliberately stop at `observable` for one foreground-delivery cycle and cannot be misread as proof that the event itself was already narrated. Only story evidence can mark an event publicly revealed. Optional cancellation and resolution conditions stop or complete the event. **Re-arm From Now** clears its runtime evidence and linked private progression records, then anchors it to the current story clock without rewriting the definition. Only messages completed after an event was saved are eligible to trigger it.

For high-confidence player-authored advances such as “five minutes pass,” a local parser checks time-only thresholds immediately after SillyTavern saves the user message and before it assembles the story request. This adds no model call. An immediately observable event whose threshold is crossed is mandatory in that same reply, rather than an optional beat on a later background pass. Same-reply action mode uses the same near-turn system block, but labels the event conditional and preserves outcome uncertainty.

Once any event reaches observable status, a separate unbudgeted delivery latch keeps it mandatory across prompt-budget competition, request races, and transient progression failures until completed prose establishes it. Each real foreground injection receives a generation receipt. The next completed reply forces an evaluator pass even when the normal progression cadence is slower; only a completed, checked reply counts as an attempt. A conservative local verifier can confirm unmistakable delivery from completed `STORY` blocks when the evaluator omits its receipt, but it never treats player text as proof. If the prose did not establish the event, delivery is queued again. Descriptions using `begins`, `starts`, or `commences` carry an onset-only boundary so delivery cannot silently complete the whole transition. After the configured maximum, automatic attempts stop visibly for manual review instead of looping forever, and **Retry Story Delivery** resets the counter. Hidden events never use this path and remain private until their reveal rule permits them to surface.

The progression response is invalid unless it contains exactly one `evaluated: true` acknowledgement and a reason for every eligible editor definition. Unknown, duplicate, omitted, actor-mismatched, pre-creation, out-of-passage, and ungrounded positive matches are rejected and repaired with the original passage and definitions still in context. Harmless `matched:false` objects and predicate labels impossible for that definition are stripped at the production boundary, preventing a provider formatting slip from discarding otherwise valid acknowledgements without granting the model any trigger authority. Revealed definitions leave the evaluator payload once they have no remaining resolution condition. The **Event Inspector** shows the exact definition payload from the last evaluator request, the evaluator's reported and locally accepted conditions, the current delivery state, and the last recorded story-delivery block. This makes “the trigger fired but never reached narration” distinguishable from “the evaluator never accepted the trigger.”

Definitions and runtime are per chat. Saving a materially changed trigger re-arms it from the current point. Swipes, edits, and message deletion preserve the user's definitions but reconstruct their runtime and evidence from the selected history, including re-anchoring relative timers if earlier inferred time changed, so discarded branches cannot leave an event fired. Deleting the chat removes both definitions and runtime with the rest of its InnerLore state.

Autonomy modes range from Advisory tracking to Conservative (default), Simulation, and Director. Conservative advances established commitments and safe background processes without freely inventing surprises. Context injection remains relevance- and budget-bounded and reserves room for goals, processes, and due beats instead of letting one category monopolize the prompt.

The curator, progression, game ledger, and scene planner requests run one after another through their profiles and commit independently. This avoids self-competition on provider concurrency limits. With **Run background passes together** (Background Model settings) they all leave at once instead, so a turn's background work takes as long as its slowest pass; use it with the Claude bridge's agent pool, which runs them side by side inside one request slot, or with a provider that serves several requests at a time. **Requests the provider can run at once** (Background Model settings) decides how background work shares the provider with the story:

- **1** (default): background work finishes first. A story request waits until running and scheduled background work is done ("Narrating - background work finishing first"), so it always carries the freshest world state, and background requests wait for a story that is being written.
- **2**: the story takes one slot and background work the other. The story leaves at once with the last finished state, and a pass already running carries on beside it. A new pass waits until the reply is finished, so it never reads a half-written reply. Background work stays one request at a time, so the provider never sees more than two. Choose 2 when the provider serves two requests at once, or when the story and InnerLore use different providers. If a provider turns out to refuse a second simultaneous request, as a one-slot fallback profile might, that request is retried once the story finishes.

If either subsystem fails, the successful one is still committed, the failed watermark stays unchanged, and bounded backoff retries analyze the missed plus current exchanges exactly once. Errors and retry timing are preserved in chat metadata instead of disappearing after a silent background failure. Pending work also resumes when the chat is reopened. Full rebuilds use larger configurable progression batches to reduce long-context request count.

## Interrupted reply recovery

When enabled, InnerLore recognizes strong transport-cutoff signals such as an unclosed quotation, a trailing connector, or missing terminal punctuation. It also rejects leading generation-control fragments such as leaked target-length, player-agency, or “keep the scene open” instructions instead of committing them as story canon. It asks SillyTavern to Continue from the exact final word and appends the result to the same message. A completely empty or control-fragment response follows a different path: the placeholder is removed and the turn is regenerated from the latest user message, because Continue has no valid prose to extend. Typed input pauses recovery, and pressing SillyTavern's Stop button is respected. The maximum automatic attempts are configurable. Failed empty, malformed, or severed replies are never counted as completed turns and never advance lore or the story clock. A manual Continue applied to a reply that InnerLore already processed triggers a clean history rebuild so story time is not counted twice.

## Latest-turn contract

Before each story generation, InnerLore quotes the newest user turn in a depth-zero system block and names the active player character. Bare player actions, first-person statements, and standalone quoted dialogue remain owned by that player; a character named only in direct address is treated as the recipient, never silently substituted as speaker. Explicitly authored NPC actions still work when the user identifies that NPC or role as the clause's actor. The curator and World Progression Engine apply the same source rule so a narration mistake cannot migrate a player action into an NPC mind, timeline, or lore record.

When conservative syntax identifies an explicit closed choice set, such as “Two options. A or B,” the block preserves those exact labels and invalidates older assistant-proposed alternatives. It also makes requested votes and other immediate procedures finish with a result, requires every counted voter or consequential speaker to have a stable name and role, and respects a user's decision to yield to the outcome. Casual uses of “or” do not create a closed set. The rules are derived from the live turn and contain no scenario-specific names, places, or canon.

Consequential character records that still exist only under a role or descriptor are listed in the contract as required identity repairs. Once story prose explicitly reveals a public name, the curator can promote the same lore entry and private mind to that name using an evidence-gated operation; the old descriptor becomes an alias rather than a duplicate character. InnerLore never invents the public name itself, and deliberate concealed or canonical anonymity remains exempt.

## History changes and branches

Message edits, swipes, and deletions can invalidate derived state. By default InnerLore debounces those events and rebuilds automatically when the chat is no longer than the configured automatic limit. Longer chats are marked as needing a manual rebuild to prevent an unexpected burst of background requests.

On load, InnerLore also compares the active chat text with the fingerprints of every processed message. This catches selected-swipe changes, restored files, and external repairs made while the extension was unloaded; stale minds, lore, and progression are quarantined before a clean rebuild.

While a rebuild is pending, the old derived injection is quarantined rather than allowed to steer new story replies. If history changes while a model request is running, InnerLore compares immutable message fingerprints, discards the stale result, and runs one deferred rebuild after the active request releases. A configurable per-attempt timeout prevents a hung provider request from holding the updater indefinitely.

Saved expression foundations carry their own capability version. After an upgrade which changes the required card-backed thought, spoken, emphasis, or personal-anchor profile, a foreground generation never waits on the transactional background request. It receives a near-turn, card-driven contract requiring character-specific thought, public/private distinction, and multiple literal surface choices; any in-flight shared-route rebuild is deferred and retried after the reply. This closes the refresh/reswipe race without letting an InnerLore provider timeout hold SillyTavern's loading spinner.

The selected chat history is the authority for automatic state. A swipe reconstructs automatic lore, private minds, story time, goals, processes, events, editor-event runtime, fingerprints, and the generated World Info mirror from the selected response. User-authored event definitions remain intact while their derived trigger evidence is replayed. Deleting one message or a tail of messages performs the same reconstruction from what remains; deleting every message clears automatic state and event runtime without making an unnecessary model request. A trailing player action is deliberately left pending, then processed together with its replacement assistant reply instead of being marked complete on its own.

“Always relevant” controls context retrieval only: pinning an automatically generated lore entry or mind does not let it survive removal of the message branch that established it. Explicitly edited lore content remains a protected manual override, consistent with the Lore Entry Editor's existing contract.

A branched chat inherits the useful state present at the branch point but receives a separate generated lorebook on first use.

## Chat deletion cleanup

InnerLore story state is owned by its SillyTavern chat. Deleting an individual or group chat permanently removes its complete server world directory, including SQLite snapshots and revision history plus the LadybugDB/SQLite graph projection. InnerLore also cancels any in-flight work for that chat, clears its runtime prompt injection, deletes every separate generated World Info book associated with the deleted chat, and deletes the portrait files the chat drew. When SillyTavern starts, InnerLore also removes the worlds, books and portrait files of chats that no longer exist (deleted with their character, removed by hand, or deleted before this cleanup existed).

Generated books carry an ownership marker in addition to their chat-id hash. A small settings registry preserves the association across chat renames, and deletion failures enter a persistent retry queue that is processed when InnerLore next loads. Ordinary SillyTavern chat backups remain subject to SillyTavern's own backup-retention and Data Maid controls; they are not active InnerLore state and are never injected after the live chat is deleted.

## Slash commands

- `/innerlore-scan` — analyze pending turns now;
- `/innerlore-rebuild` — reconstruct state from the full current chat;
- `/innerlore-status` — show state counts and the processing watermark.
- `/innerlore-time` — show the elapsed story-time estimate, uncertainty range, and latest time label/anchor.

## Privacy

Background analysis sends the selected recent chat passage, the relevant existing state, and selected character-card fields to the configured model connection. It does not include API keys in extension storage. Provider privacy, retention, and moderation behavior still apply. If the Connection Profile uses OpenRouter with account-wide ZDR, only ZDR-compatible routes can serve these calls.

## Development test

From the SillyTavern directory:

```bash
node --test data/default-user/extensions/SillyTavern-InnerLore/tests/*.test.mjs
node data/default-user/extensions/SillyTavern-InnerLore/tests/init-smoke.mjs
```

The tests cover malformed JSON extraction, interrupted/control-fragment prose detection, alias-safe canonical merges, omission-safe canon retention, explicit thread resolution, importance filtering, stable spatial invariants and return-visit deltas, Persistent Self round trips, two-observation durable-facet promotion, transient-state replacement, memory consolidation, multidimensional relationship changes, voice differentiation for identical events, private/spoken contradiction guidance, natural intensity guidance, selective psychology retrieval, one-way saved-brain migration, twelve-character mind isolation, long-running location/item transitions, current-scene movement, dormant-lore exclusion, duplicate suppression, boundary-safe context rendering, fair bounded injection, SummarySception ghost compatibility, native lorebook persistence, request cancellation/timeouts, full swipe/delete rollback, pending-action replay, empty-history cleanup, swipes during active analysis, uncertain progression deadlines, player-agency enforcement, failed-agent catch-up without double counting, same-reply time and action delivery, strict evaluator coverage and evidence validation, impossible-field normalization, locally verified delivery receipts, onset-only boundaries and bounded retries, observable-event latching across provider failures, editor-event time/action/actor/reveal/cancellation rules, event rollback across swipes, and a 1,200-exchange simulation with 50 hidden event watchers.

## License and credits

InnerLore is released under the MIT License. The project credits LewdLeah's Inner Self and Auto-Cards as its design inspiration; both source projects are also MIT-licensed. InnerLore does not claim authorship of those projects.
