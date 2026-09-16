# InnerLore — Living Characters & World

InnerLore is a SillyTavern client extension backed by its bundled `innerlore-storage` server plugin (pure SQLite) for four related jobs:

1. **Private character minds:** each relevant NPC has a durable Persistent Self, an individual textual voice, multidimensional subjective relationships, and one replaceable Current Mind for the immediate scene.
2. **Automatic living lore:** individually significant characters, locations, items, factions, organizations, creatures, events, and concepts become detailed native World Info entries and continue updating as the story changes.
3. **World progression:** a private chronologist infers elapsed fictional time from completed player/story exchanges and advances durable goals, processes, deadlines, and restrained story beats.
4. **Editor-authored events:** reusable per-chat events watch story time and completed player or NPC actions, progress privately off screen, and become visible only under their configured reveal rules.

It is designed for arbitrary character cards and genres. No scenario, relationship, setting, or canon fact is hard-coded.

## Installation

**Requirements**

- SillyTavern 1.13+ (tested on 1.13.x)
- Any chat-completion API connection (OpenAI-compatible, OpenRouter, z.ai, etc.) — one profile for the story model, and optionally a second, cheaper profile for background analysis

**State storage:** the bundled **`innerlore-storage`** server plugin keeps everything in pure SQLite (see install step 2) — this is the default and recommended mode. An *Embedded* fallback (state inside the chat file) is available in **InnerLore → State storage** for zero-plugin setups.

**Installing the extension + bundled SQLite storage**

1. In SillyTavern, open **Extensions → Install extension**, and paste:

   ```
   https://github.com/ChrisDitfort/SillyTavern-InnerLore
   ```

2. Install the bundled storage plugin — the repository is dual-mode, so the same URL works (pure SQLite, zero npm dependencies — uses Node's built-in `node:sqlite`, requires Node 22.5+):

   ```
   # from your SillyTavern folder
   git clone https://github.com/ChrisDitfort/SillyTavern-InnerLore plugins/SillyTavern-InnerLore
   ```

   Then set `enableServerPlugins: true` in `config.yaml` and restart SillyTavern. Prefer not to clone twice? Run `node setup.js` from either checkout instead — cross-platform (Linux/macOS/Windows, Node only), it auto-detects the SillyTavern root, links the bundled plugin into `plugins/` (junction/symlink with copy fallback), and flips the config flag with a backup.
3. After the restart, confirm the plugin: `GET /api/plugins/innerlore-storage/v1/health`.
4. Open the **InnerLore** panel in Extensions, pick a background-model connection profile, and press **Test Connection**.
5. Open any character chat — the first analysis pass builds the initial lore and minds automatically after the next story reply (or press **Scan New Turns**).

All state — entities, minds, progression, narrative history — lives in a single SQLite database at `data/worlds/innerlore-storage.db` with per-save revision history (last 20 per chat). No chat-JSONL state, no external services.

The narrator prompt, narration length (Brief / Standard / Long), context budgets, history handling, and event behavior are all configured from the InnerLore panel — no prompt-manager editing required.

## Inspiration and architecture

The concept is inspired by LewdLeah's MIT-licensed [Inner Self](https://github.com/LewdLeah/Inner-Self) and [Auto-Cards](https://github.com/LewdLeah/Auto-Cards) for AI Dungeon. InnerLore is an independent SillyTavern implementation rather than a port of AI Dungeon's hook protocol.

AI Dungeon's scripts ask the story model to emit maintenance syntax inside the normal generation and then parse it. InnerLore instead:

- runs a separate background model request after a story reply;
- requests a separately validated maintenance patch, using strict JSON by default or the experimental line-oriented InnerLore DSL v1;
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

**Strict JSON** remains the default and is the recommended compatibility mode. **InnerLore DSL v1** is an experimental line-oriented transport intended to reduce braces, commas, quoting, and array-index mistakes in long curator, progression, and Event Director responses. A typical record begins with `LOCATION Ben Tavern`, contains `field = value`, `facts += value`, and nested `ITEM spatial.set` blocks, then closes with `END`; the document closes with `DONE`.

The DSL middleware parses into the exact same canonical objects used by JSON mode. The existing domain validators still reject missing evidence, omitted trigger acknowledgements, unsafe paths, unsupported fields, and invalid canon operations. A bounded set of lossless structural variations is normalized locally and recorded for diagnostics. Provider behaviour varies, so DSL should remain opt-in until it proves reliable with the chosen background model.

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

An old packet is never reused across a revision or branch-head mismatch. The section budgets in InnerLore settings become safe per-request profile overrides; named server profiles remain revisioned in SQLite for reusable configurations.

## World Progression Engine

The progression agent runs after completed story replies. It estimates elapsed time from both the attempted player action and what the narration confirms actually occurred. A walk across a room and a greeting therefore advances seconds even without “later” or “the next morning”; overlapping restatements of the same action count once. New NPC dialogue, pauses, reactions, and consequences in the reply add time. Dialogue turns are sequential by default, while overlap is accepted only with explicit confirmation and evidence. Explicit clocks, waits, travel durations, sleep, montages, and scene cuts take priority over soft action-duration estimates.

The private per-chat state contains:

- an uncertainty-aware elapsed clock and optional story-time labels/anchors;
- NPC, faction, group, and world goals with progress, blockers, next steps, and deadlines;
- ongoing character, location, item, faction, and world processes;
- latent, scheduled, possibly-due, due, off-screen, revealed, and cancelled beats;
- a bounded audit log and an independent processing watermark.

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

The curator and progression requests run sequentially through the selected background profile and commit independently. This avoids self-competition on provider concurrency limits. If either subsystem fails, the successful one is still committed, the failed watermark stays unchanged, and bounded backoff retries analyze the missed plus current exchanges exactly once. Errors and retry timing are preserved in chat metadata instead of disappearing after a silent background failure. Pending work also resumes when the chat is reopened. Full rebuilds use larger configurable progression batches to reduce long-context request count.

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

InnerLore story state is owned by its SillyTavern chat. Deleting an individual or group chat permanently removes its complete server world directory, including SQLite snapshots and revision history plus the LadybugDB/SQLite graph projection. InnerLore also cancels any in-flight work for that chat, clears its runtime prompt injection, and deletes every separate generated World Info book associated with the deleted chat.

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
