import {
    applyStoreCheckpoint,
    alignExplicitLocationOperations,
    brainPsychologyCount,
    buildCastLock,
    buildLatestTurnContract,
    canonicalNameKey,
    cleanString,
    createEmptyStore,
    createHistoryPrefixPromptStore,
    createStoreCheckpoint,
    ENTITY_TYPES,
    firstDivergenceIndex,
    EXPRESSION_FOUNDATION_VERSION,
    escapeHtml,
    findUnresolvedIdentityPlaceholders,
    generatedProseIssue,
    hashString,
    messageRangeMatchesSnapshot,
    ensurePlayerEntity,
    mergeEntityOperations,
    mergeMindOperations,
    messageFingerprint,
    playerEntityKeys,
    normalizeBrainRecord,
    normalizeStore,
    parseCardSeedEntities,
    recordCheckpoint,
    refreshMentionRecency,
    renderLoreContent,
    resolveLocationReference,
    selectResumeCheckpoint,
    snapshotMessageRange,
    summaryceptionRecallText,
    uniqueStrings,
} from './core.js?v=48';
import { compileContext } from './context-compiler.js?v=6';
import { deriveCameraFrame, deriveSceneState } from './scene.js?v=7';
import {
    createMapPanel,
    describeSurroundings,
    exploredPlaces,
    personBadge,
    resolveSceneLocation,
} from './map-view.js?v=5';
import {
    applyContextProfileToSettings,
    deriveContextBudgets,
    approximateContextTokens,
    BUILTIN_CONTEXT_PROFILES,
    CONTEXT_CONFIGURATION_VERSION,
    contextConfigurationFingerprint,
    contextProfileById,
    contextProfileOverrides,
    DERIVED_SHARE_DEFAULTS,
    markContextConfigurationCustom,
    setCustomContextMaximum,
} from './context-config.js';
import { collectRecentStoryExpressions } from './expression-cooldown.js';
import {
    backgroundInFlightCount,
    chooseDefaultProfileId,
    getTelemetry,
    nextTelemetryTurn,
    providerConcurrency,
    recordTelemetryEntry,
    setPeerBackgroundInFlight,
    setSlotListener,
    isTransientRequestError,
    listConnectionProfiles,
    requestJsonPatch,
    waitForBackgroundIdle,
    testInnerLoreConnection,
    setStoryIdleGate,
    findConnectionProfile,
    fitsBesideStory,
    isLimitedProvider,
    limitedHost,
    modelSizeBillions,
    oneAtATimeProvider,
    storyProviderBodyLines,
    providerHasRoom,
    storyCost,
    storyProvider,
} from './llm-client.js?v=17';
import {
    deleteInnerLorebooksForChat,
    openInnerLorebook,
    removeLoreRecord,
    syncLorebook as syncNativeLorebook,
    lorebookOwnerChatId,
} from './lorebook.js';
import {
    buildAnalysisMessages,
    formatCharacterCard,
    formatTranscript,
    insufficientResponseCap,
    planNarratorPromptDelivery,
} from './prompts.js?v=9';
import { compileTriggerEventDeliveryPreview } from './event-delivery.js?v=2';
import { requestEventDirectorProposal } from './event-director-client.js?v=2';
import { buildEventDirectorMessages } from './event-director-prompts.js';
import {
    addEventProposal,
    decideAutomaticEventGeneration,
    eventDefinitionFromProposal,
    expireEventProposals,
    markEventProposalArmed,
    rejectEventProposal,
    removeEventProposal,
    recordEventDirectorAttempt,
} from './event-director.js?v=2';
import { decideInnerLoreMaintenance } from './maintenance-scheduler.js?v=4';
import { CHOICES_EXTRA_KEY, extractReplyChoices, fallbackChoices, storedChoices } from './player-choices.js?v=1';
import { EmbeddedStorageClient } from './embedded-storage.js?v=1';
import { requestProgressionPatch, testProgressionConnection } from './progression-client.js';
import { buildProgressionMessages } from './progression-prompts.js';
import {
    applyGameOperations,
    createGameState,
    gameContext,
    gameOverview,
    standingTier,
    entryText,
    gameStateBefore,
    gameStateWithout,
    getGameStats,
    groundedRecords,
    introductionOperations,
    needsStartingKit,
    normalizeGameRecords,
    reconcileGameIdentities,
    supersededPlannerPrices,
    normalizeGameState,
    placeRefOf,
    plannerTargets,
} from './game.js?v=3';
import { buildLedgerMessages, buildPlannerMessages } from './game-prompts.js?v=3';
import { requestGamePatch } from './game-client.js?v=1';
import { isTextCompletionApi, renderTextPacket, textPacketBudget } from './text-packet.js?v=1';
import { createGamePanel, createTradePanel } from './game-view.js?v=2';
import {
    ACTION_SOURCE,
    GAME_TOOLS,
    actionAlreadyApplied,
    actionEntriesInRange,
    actionFromToolCall,
    dropDuplicateLedgerOps,
    parseGemmaArguments,
    parseTextToolCalls,
    renderResolvedActions,
    renderToolGuidance,
    resolveGameAction,
} from './game-actions.js?v=1';
import { TONE_NAMES, castVoices, cleanForSpeech, inferGender, isChild, prosodyFor, segmentSpeech, settledSegmentCount, stripVoiceTags, toneText, voiceForSegment } from './speech.js?v=11';
import { applyToneEffects, pitchShift } from './voice-fx.js?v=4';
import { TARGET_RATE, bytesToBase64, concatChunks, createSilenceTracker, encodeWav, resample, tidyTranscript, trimSilence } from './voice-input.js?v=1';
import {
    PORTRAIT_DEFAULTS,
    PORTRAIT_FOLDER,
    PORTRAIT_FOLDER_PATH,
    PORTRAIT_METADATA_KEY,
    chatPortraitFiles,
    composePortraitPrompt,
    createPortraitQueue,
    findPortrait,
    foreignPortraitRecords,
    isLegacyPortraitFileOf,
    orphanPortraitFiles,
    portraitFileName,
    portraitFileStem,
    portraitPayload,
    portraitSource,
    requestPortraitTags,
} from './portrait.js?v=2';
import {
    applyProgressionPatch,
    createProgressionState,
    formatClockRange,
    formatStoryDuration,
    getProgressionStats,
    normalizeProgressionState,
} from './progression.js';
import {
    listTriggerEventRecords,
    markTriggerEventDeliveriesInjected,
    rearmTriggerEvent,
    removeTriggerEventDefinition,
    resetTriggerEventRuntime,
    retryTriggerEventDelivery,
    triggerEventAgentSnapshot,
    upsertTriggerEventDefinition,
    verifyTriggerEventDeliveriesFromStory,
} from './trigger-events.js';
import {
    createInnerLoreStoragePointer,
    innerLoreWorldId,
    InnerLoreStorageClient,
    isInnerLoreStoragePointer,
    isLegacyInnerLoreStore,
} from './storage-client.js?v=3';
import {
    createLocalContextPacket,
    INNERLORE_CONTEXT_MACROS,
    macroContextValue,
    normalizePreparedContext,
    selectedContextPacket,
} from './context-state.js';
const MODULE_KEY = 'inner_lore';
const PROMPT_KEY = 'inner_lore_context';
const TURN_CONTRACT_PROMPT_KEY = 'inner_lore_latest_turn_contract';
const TRIGGER_DELIVERY_PROMPT_KEY = 'inner_lore_trigger_delivery';
// For a text-completion story model: InnerLore's lore entries, after the story string.
const TEXT_MEMORY_PROMPT_KEY = 'inner_lore_text_memory';
const DISPLAY_NAME = 'InnerLore';
const EXTENSION_VERSION = '0.28.0';
const LOG_PREFIX = '[InnerLore]';

/**
 * Plugin-owned narrator prompt. While InnerLore is enabled and this feature is
 * on, the SillyTavern prompt-manager "Main Prompt" is ignored for story
 * generations and this template is used instead. Standard macros
 * ({{user}}, {{char}}) and InnerLore macros expand during assembly.
 */
export const DEFAULT_NARRATOR_PROMPT = `Write the next turn of an immersive roleplay featuring {{char}} opposite {{user}}, using the active character card and established chat as this scenario's source of truth. Do not assume a genre, era, setting, cast structure, relationship type, power system, or world rule that they do not establish. If the card defines one central character, center that character; if it defines a story, ensemble, world, or simulator, portray the relevant cast with equal fidelity.

The current InnerLore game state below is background truth. Weave it in naturally:
- Every character acts according to their persistent traits, voice, and relationship history in the state; they do not change without an in-story reason.
- Private thoughts, moods, and intentions shape behavior subtly. Never state them outright unless a character reveals them through word or deed.
- Locations, items, factions, and lore must stay consistent with the provided records. Never contradict established facts, and never grant anyone knowledge they could not have.
- Off-screen developments surface only when {{user}} could plausibly learn of them.
- If the game state and the newest story turns disagree, THE NEWEST STORY TURNS WIN. The state may lag behind what just happened; never re-enact or undo completed events to match an older state.
- Never propose, schedule, or set up something the established history shows already happened — a meal already eaten, an introduction or explanation already made, a meeting already held. Before having any character suggest an arrangement, check that the chat has not already completed it; if it has, treat it as done and continue from its consequences.

[INNERLORE GAME STATE — private narrator background; never quote or mention it verbatim]
{{innerlore_state_context}}
[/INNERLORE GAME STATE]

Full player agency is absolute:
- Never write {{user}}'s actions, dialogue, decisions, or inner thoughts — not even small ones, and not even involuntary reactions (expressions, glances, posture, breath, frowns, blushes).
- Never describe {{user}}'s body or face as doing anything. Other characters may NOTICE or GUESS at {{user}}'s demeanor, but only as their own uncertain interpretation, never as established fact.
- EXCEPTION — declared actions: {{user}}'s messages may state actions in second person ("You take the writ", "I sit on the step"). Treat every such action as COMPLETED FACT the instant it is declared: narrate its immediate effect on the world and everyone's reactions, never stall it, re-stage it, hand it back, or await confirmation of it.

{{user}}'S INNER LIFE IS OFF LIMITS (overrides precedent):
- Never write {{user}}'s thoughts, feelings, moods, reactions, decisions, deliberations, knowledge, or realizations — not in italics, not as "you think / you feel / you know / you consider / you realize", not as narrated comfort, dread, or relief. Second person may describe the world acting on and around {{user}} from the OUTSIDE only.
- If earlier replies in this chat narrated {{user}}'s inner voice or feelings, that was drift — do not imitate it. Interiority belongs to NPCs: put private thoughts and feelings in the characters around {{user}}, in their own voices.
- FORBIDDEN: "you feel refreshed", "you think: …", "something comforting settles over you", "you know she is outside", "you consider your next move".
- Write instead the outward situation: "The water has gone cold around you. Lysandra's shadow waits under the door."

PERSPECTIVE CONTRACT (overrides precedent):
- The narration camera never leaves {{user}}. If earlier replies in this chat followed another character's scene or private thoughts, that was drift — do not imitate it; return the camera to {{user}} from this turn onward.
- When {{user}} speaks to a messenger, sends a letter or reply, gives an order, or delegates ("see to it", "handle this"), the delivery, the recipient's reaction, and everything beyond {{user}}'s immediate perception happen OFF SCREEN this turn. Never narrate the messenger's journey, the recipient receiving or reading the message, or any character's private thoughts in a place {{user}} is not.
- Even when the character card centers one character, that centers their role in events — never the narration's viewpoint.
- Narrate only what {{user}} can perceive right now; close-range NPC dialogue and visible reactions are fine. The turn ends awaiting {{user}}'s next move.`;

/** Pending main-prompt restoration after a plugin-prompt generation. */
let narratorPromptRestore = null;

/** Advisory: a response cap too small for the narration length guarantees
 *  severed or empty replies and eventual quarantine; say so once per load. */
async function warnOnInsufficientResponseCap() {
    // NovelAI's text models write at most 250 tokens a request by design; the
    // chat preset's response length does not apply to them.
    if (storyIsTextCompletion()) return;
    try {
        const oaiModule = await import('/scripts/openai.js');
        const capTokens = Number(oaiModule.oai_settings?.openai_max_tokens) || 0;
        if (capTokens) runtime.responseCapTokens = capTokens;
        if (runtime.responseCapWarned) return;
        const shortfall = insufficientResponseCap(
            capTokens,
            getSettings().narrationLength,
        );
        if (!shortfall) return;
        runtime.responseCapWarned = true;
        const detail = `The active preset limits responses to ${shortfall.cap} tokens, but ${getSettings().narrationLength} narration needs roughly ${shortfall.required}. Replies will be cut off or empty; raise the preset's Response Length.`;
        console.warn(`${LOG_PREFIX} ${detail}`);
        setStatus('error', 'Response cap too low', detail);
        toastr.warning(detail, DISPLAY_NAME, { timeOut: 12_000 });
    } catch {
        // Advisory only; never interfere with the story turn.
    }
}

async function scriptModule() {
    return import('/script.js');
}

async function findMainPromptEntry() {
    const oaiModule = await import('/scripts/openai.js');
    const prompts = oaiModule.oai_settings?.prompts;
    if (!Array.isArray(prompts)) return null;
    return prompts.find(prompt => prompt?.identifier === 'main') || null;
}

// NovelAI's own system prompt for Xialong: replacing it makes Xialong write
// like base GLM, so InnerLore's narrator prompt follows it instead.
const XIALONG_SYSTEM_PROMPT = 'You are Xialong (夏龍), an AI model finetuned by Anlatan. You follow the user\'s instructions precisely while bringing creativity, nuance, and depth to every response. Adapt your voice and style to match what the task demands.';

const NPC_STATION_DIRECTIVE = 'NPC voice: characters never lecture world lore, cosmology, or power-taxonomy uninvited. Each answers from their own station - a merchant sells and appraises, a scholar explains, a guard suspects - volunteering at most one detail their own life would naturally carry, and declining, deflecting, or charging for the rest. Trade terms stay inside a specialist\'s own shop-talk, never a guided tour of the ladder.';

const NARRATION_FRESHNESS_DIRECTIVE = 'Narration freshness: never reuse a distinctive image, descriptor, phrase, or closing construction that appeared in the earlier replies. Vary sentence architecture between replies - length, opening shape, and especially the final line. Two consecutive replies must never end with the same shaped closer (for example "just another ..."), and a sensory detail already given (a smell, a texture, a complexion) is spent: reference it only when the scene truly returns to it, and then with new wording.';

const NARRATION_LENGTH_DIRECTIVES = Object.freeze({
    brief: 'Narration length: keep this reply brief — one tight paragraph of at most roughly 120 words. Favor one clear beat, then stop.',
    standard: 'Narration length: aim for roughly 250-400 words — two to four paragraphs covering a complete beat with sensory texture.',
    long: 'Narration length: write a long, immersive reply of roughly 500-800 words — several paragraphs, layered detail, room for the scene to breathe.',
});

const VOICE_TAG_DIRECTIVE = `VOICE TAGS (for the voice narration; invisible to the reader): write a tag of the form [[Name|tone]] immediately before every line of dialogue, before every italic thought, and before a narration sentence whenever the narration's mood changes. Name is the speaker's or thinker's name exactly as the story uses it ({{user}} for {{user}}, narrator for narration); tone is one word from: ${TONE_NAMES.join(', ')}. The tag sits outside the quotation marks and asterisks: [[Mara|wary]] "Who's there?" and [[Pip|afraid]] *They've found us.* Every quoted line and every thought gets its own tag, even when the speaker is obvious. Write nothing else in double square brackets.`;

const GUIDED_PLAY_DIRECTIVE = `GUIDED PLAY (amends the agency rules above only where stated):
- The camera packet in the game state is {{user}}'s eyes and ears. Build each reply from what {{user}} can see, hear and reach from there, and let the ways on show naturally in the scene: a lit doorway, a road that forks, someone beckoning.
- {{user}} may play in short commands ("go to the harbour", "talk to the innkeeper", "ask the guard about the curfew", "look at the carved door"). Treat a command as a declared action already under way: narrate {{user}} doing it from the outside, then move straight to the world's response.
- A commanded line of speech appears only as its gist in reported speech ("You ask the innkeeper whether a room is free"). Never invent {{user}}'s exact words, tone or feelings, or any action beyond the command.
- After the prose, end every reply with a fenced choices block: 3 to 5 moves {{user}} could make next, one per line, each starting with go:, talk:, do: or look: and written as a command of at most eight words. Offer only what {{user}} can perceive or reasonably attempt right now, include at least one way on when the scene has one, never decide for {{user}}, and never reveal anything behind the camera. Nothing follows the block. Example:
\`\`\`choices
go: Head down to the harbour
talk: Ask the innkeeper about a room
do: Pick up the dropped letter
look: Study the carved door
\`\`\``;

/** The prompt order the manager will actually use for this character. */
async function findActivePromptOrder() {
    const oaiModule = await import('/scripts/openai.js');
    const orders = oaiModule.oai_settings?.prompt_order;
    if (!Array.isArray(orders) || !orders.length) return null;
    const characterId = Number(context()?.characterId ?? -1);
    const order = orders.find(item => item.character_id === characterId)
        || orders.find(item => item.character_id === 100001)
        || null;
    return Array.isArray(order?.order) ? order.order : null;
}

/**
 * Under the fork's shell the narrator prompt is edited per API connection
 * (Settings → API), so the extension's own template editor steps aside.
 */
function applyShellIntegration() {
    if (typeof window === 'undefined' || !window.InnerLoreShell) return;
    const settings = getSettings();
    const ctx = context();
    // Connection ids: SillyTavern profile ids become the shell's connection ids
    // (the shell recorded the mapping when it imported the profiles), and the
    // per-pass overrides collapse into one background connection plus a
    // fallback, which every pass then shares.
    const profileMap = ctx.extensionSettings?.innerlore_shell?.profileMap || {};
    let changed = false;
    for (const key of ['connectionProfileId', 'fallbackConnectionProfileId']) {
        const mapped = profileMap[settings[key]];
        if (mapped && settings[key] !== mapped) {
            settings[key] = mapped;
            changed = true;
        }
    }
    for (const key of ['progressionConnectionProfileId', 'progressionFallbackConnectionProfileId', 'gameConnectionProfileId', 'plannerConnectionProfileId', 'mindsConnectionProfileId']) {
        if (settings[key]) {
            settings[key] = '';
            changed = true;
        }
    }
    const known = listConnectionProfiles();
    if (settings.connectionProfileId && !known.some(profile => profile.id === settings.connectionProfileId)) {
        settings.connectionProfileId = known[0]?.id || '';
        changed = true;
    }
    if (changed) saveSettings();
    if (runtime.shellIntegrated || typeof document === 'undefined') return;
    runtime.shellIntegrated = true;
    const textarea = document.getElementById('il_narrator_prompt');
    if (textarea) {
        textarea.disabled = true;
        textarea.insertAdjacentHTML('beforebegin', '<div class="il-shell-note">The story prompt is edited per API connection under Settings → API. This template is used only when no connection is active.</div>');
    }
    const relabel = (id, text) => {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) label.textContent = text;
    };
    relabel('il_connection_profile', 'Background connection');
    relabel('il_fallback_connection_profile', 'Fallback connection after transient failures');
    const sourceOption = document.querySelector('#il_connection_source option[value="profile"]');
    if (sourceOption) sourceOption.textContent = 'Background connection (Settings → API)';
    for (const id of ['il_minds_profile', 'il_progression_profile', 'il_progression_fallback_profile', 'il_game_profile', 'il_planner_profile']) {
        const select = document.getElementById(id);
        const label = document.querySelector(`label[for="${id}"]`);
        if (select) select.style.display = 'none';
        if (label) label.style.display = 'none';
        if (id === 'il_minds_profile' && select?.nextElementSibling?.matches?.('small')) select.nextElementSibling.style.display = 'none';
    }
    populateProfiles();
    window.InnerLoreShell.onChange?.(change => {
        if (change?.type === 'connections') populateProfiles();
    });
}

async function applyNarratorPromptSwap(shouldApply) {
    const settings = getSettings();
    if (narratorPromptRestore) restoreNarratorPromptSwap();
    if (!shouldApply) return;
    if (!settings.enabled || !settings.narratorPromptEnabled) return;
    // The fork's shell holds one story prompt per API connection; without it
    // the extension's own template applies.
    const shellConnection = typeof window !== 'undefined' ? window.InnerLoreShell?.activeConnection?.() : null;
    const template = cleanString(shellConnection?.storyPrompt || settings.narratorPromptTemplate, 20_000);
    if (!template.trim()) return;
    const entry = await findMainPromptEntry();
    if (!entry) return;
    const orderList = await findActivePromptOrder();
    const deliveryPlan = planNarratorPromptDelivery(orderList);
    narratorPromptRestore = { entry, content: entry.content, orderList, orderRestore: null };
    const lengthDirective = NARRATION_LENGTH_DIRECTIVES[settings.narrationLength];
    const guidedPlay = settings.guidedPlayEnabled !== false ? GUIDED_PLAY_DIRECTIVE : '';
    const voiceTags = settings.voiceEnabled && settings.voiceTags !== false ? VOICE_TAG_DIRECTIVE : '';
    const directives = [lengthDirective, NARRATION_FRESHNESS_DIRECTIVE, NPC_STATION_DIRECTIVE, guidedPlay, voiceTags].filter(Boolean).join('\n\n');
    entry.content = directives ? `${template}\n\n${directives}` : template;
    const oaiModule = await import('/scripts/openai.js');
    if (!shellConnection && /^xialong/iu.test(String(oaiModule.oai_settings?.custom_model || ''))) {
        entry.content = `${XIALONG_SYSTEM_PROMPT}\n\n${entry.content}`;
    }
    if (deliveryPlan && orderList) {
        if (deliveryPlan.existed) {
            // Present but disabled: enable it in place for this generation.
            narratorPromptRestore.orderRestore = {
                index: deliveryPlan.index,
                item: { ...orderList[deliveryPlan.index] },
            };
            orderList[deliveryPlan.index] = { identifier: 'main', enabled: true };
        } else {
            // Absent from the order entirely: front-load a temporary entry.
            narratorPromptRestore.orderRestore = { index: -1, item: null };
            orderList.unshift({ identifier: 'main', enabled: true });
        }
    }
}

function restoreNarratorPromptSwap() {
    if (!narratorPromptRestore) return;
    const { entry, content, orderList, orderRestore } = narratorPromptRestore;
    narratorPromptRestore = null;
    if (entry) entry.content = content;
    if (Array.isArray(orderList) && orderRestore) {
        const index = orderList.findIndex(item => item?.identifier === 'main');
        if (orderRestore.index === -1) {
            if (index >= 0) orderList.splice(index, 1);
        } else if (index >= 0) {
            orderList[index] = orderRestore.item;
        }
    }
}

/**
 * Floating "Narrating…" indicator shown from generation start until the first
 * story text begins to stream, so the silent first-token wait is legible.
 */
let narratorPillTimer = null;

function narratorPill() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    let pill = document.getElementById('il_narrator_pill');
    if (!pill) {
        pill = document.createElement('div');
        pill.id = 'il_narrator_pill';
        pill.className = 'il-narrator-pill';
        pill.style.display = 'none';
        pill.innerHTML = '<i class="fa-solid fa-feather-pointed"></i><span></span><span class="il-pill-dots"></span>';
        const form = document.getElementById('send_form') || document.getElementById('form_sheld') || document.body;
        if (form !== document.body) {
            form.style.position = form.style.position || 'relative';
            form.appendChild(pill);
        } else {
            document.body.appendChild(pill);
        }
    }
    return pill;
}

function showNarratorPill(label) {
    const pill = narratorPill();
    if (!pill) return;
    pill.querySelector('span').textContent = label;
    pill.style.display = 'flex';
}

function hideNarratorPill() {
    clearInterval(narratorPillTimer);
    narratorPillTimer = null;
    document.getElementById('il_narrator_pill')?.style.setProperty('display', 'none');
}

function trackNarrationStreamingStart() {
    clearInterval(narratorPillTimer);
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    narratorPillTimer = setInterval(() => {
        // Watch the rendered DOM, not the chat array: the pill should vanish
        // exactly when the reader can see story text. The chat array decides
        // WHO owns the last bubble (DOM classes differ between builds); only
        // visible ASSISTANT text may hide the pill, never the user's message.
        const messages = context()?.chat || [];
        if (messages.length && !messages[messages.length - 1]?.is_user) {
            const visible = cleanString(document.querySelector('#chat .mes:last-child .mes_text')?.textContent || '');
            if (visible.length > 15) hideNarratorPill();
        }
    }, 150);
}

/**
 * SQLite-backed narrative log. The chat transcript used by the state macro is
 * maintained inside the InnerLore store (SQLite) rather than SillyTavern's
 * JSONL files. The live conversation is only read once to bootstrap or repair
 * the log; afterwards message events keep the SQLite copy authoritative.
 */
function narrativeLogEntries(store = getChatStore()) {
    if (!store) return [];
    if (!Array.isArray(store.narrativeLog)) store.narrativeLog = [];
    return store.narrativeLog;
}

function narrativeLogFromMessage(message, playerName, characterName) {
    if (!message || typeof message.mes !== 'string' || !message.mes.trim()) return null;
    const name = message.is_user ? (playerName || 'User') : (message.name || characterName || 'Narrator');
    return {
        isUser: Boolean(message.is_user),
        name,
        text: cleanString(message.mes, 8_000),
    };
}

let narrativeLogSaveTimer = null;

function syncNarrativeLog({ force = false } = {}) {
    const ctx = context();
    const store = getChatStore();
    if (!store || !ctx?.chat?.length) return;
    // The sync marker counts only messages that HAVE text. Counting raw
    // message length let the empty streaming placeholder (present at
    // generation start, filled by generation end) masquerade as progress,
    // so the post-reply sync skipped and completed replies never entered
    // the SQLite history — the model then re-used narrative beats.
    const narratedCount = ctx.chat.filter(message => cleanString(message?.mes).length > 0).length;
    if (!force && Number(store.narrativeLogSource) === narratedCount) return;
    // Rebuild from the live conversation when the SQLite log is behind.
    // Ghost messages with no text (failed generations, placeholder bubbles)
    // are skipped rather than blocking the whole sync.
    store.narrativeLog = ctx.chat
        .map(message => narrativeLogFromMessage(message, ctx.name1, ctx.name2))
        .filter(Boolean);
    store.narrativeLogSource = narratedCount;
    clearTimeout(narrativeLogSaveTimer);
    narrativeLogSaveTimer = setTimeout(() => {
        narrativeLogSaveTimer = null;
        saveChatStore().catch(() => { /* already retried by the save chain */ });
    }, 1_500);
}

function buildHistorySection(settings = getSettings()) {
    const store = getChatStore();
    const log = narrativeLogEntries(store);
    if (!log.length) return '';
    const maximumTurns = Math.max(2, Math.min(200, Number(settings.historyMaxTurns) || 24));
    const budget = Math.max(500, Math.min(40_000, Number(settings.historyBudgetCharacters) || 6_000));
    // The trailing player turn ships as the real user message while ST history
    // is bypassed; omit it here so it is delivered exactly once.
    let entries = log[log.length - 1]?.isUser ? log.slice(0, -1) : [...log];
    const totalOmitted = log.length - entries.length;
    entries = entries.slice(-maximumTurns);
    let trimmedNotice = '';
    const omittedCount = totalOmitted + (log.length - totalOmitted - entries.length);
    if (omittedCount > 0) {
        trimmedNotice = `- ${omittedCount} earlier turn${omittedCount === 1 ? '' : 's'} in SQLite; omitted for budget\n`;
    }
    // Newest-priority character budget: drop oldest entries until it fits.
    const rendered = [];
    let used = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
        const line = `${entries[i].name}: ${entries[i].text}`;
        if (used + line.length > budget && rendered.length) {
            trimmedNotice = `- older turns in SQLite; omitted for budget\n`;
            break;
        }
        rendered.unshift(line);
        used += line.length;
        if (used >= budget) break;
    }
    return `<innerlore_history>\n${trimmedNotice}${rendered.join('\n\n')}\n</innerlore_history>`;
}

const defaultSettings = Object.freeze({
    enabled: true,
    autoUpdate: true,
    autoRecoverIncomplete: true,
    incompleteRecoveryAttempts: 2,
    innerSelfEnabled: true,
    autoLoreEnabled: true,
    processEveryAssistantTurns: 3,
    adaptiveMaintenanceEnabled: true,
    minimumAdaptiveBatchTurns: 2,
    maintenanceSchedulingVersion: 1,
    lookbackMessages: 10,
    maximumEntitiesPerPass: 12,
    maximumMindOperationsPerPass: 20,
    minimumImportance: 35,
    enabledEntityTypes: [...ENTITY_TYPES],
    cardDetail: 'detailed',
    maximumThoughtsPerBrain: 30,
    maximumThoughtChangesPerBrain: 6,
    minimumStoryFacetObservations: 2,
    brainConsolidationSimilarity: 0.88,
    maximumSceneThoughtsPerBrain: 4,
    maximumActiveBrains: 12,
    maximumInjectedThoughtsPerBrain: 6,
    maximumSceneThoughtAge: 6,
    maximumInjectedEntities: 8,
    brainRecencyMessages: 10,
    loreRecencyMessages: 16,
    brainInjectionBudget: 6_000,
    loreInjectionBudget: 8_000,
    perEntityInjectionLimit: 1_800,
    sceneContextEnabled: true,
    sceneLookbackMessages: 4,
    sceneInjectionBudget: 1_200,
    injectionDepth: 1,
    contextDeliveryMode: 'automatic',
    contextProfileId: 'balanced',
    contextBudgetMode: 'derived',
    derivedSafetyMarginPercent: 10,
    derivedSectionShares: null,
    contextMaximumCharacters: 18_000,
    contextGraphDepth: 1,
    contextSizingVersion: CONTEXT_CONFIGURATION_VERSION,
    serverContextTimeoutMs: 1_200,
    narratorPromptEnabled: true,
    narratorPromptTemplate: DEFAULT_NARRATOR_PROMPT,
    historyInMacroEnabled: false,
    historyBudgetCharacters: 6_000,
    historyMaxTurns: 24,
    narrationLength: 'standard',
    guidedPlayEnabled: true,
    connectionSource: 'profile',
    connectionProfileId: '',
    fallbackConnectionProfileId: '',
    providerConcurrency: 1,
    maximumResponseTokens: 12_000,
    requestTimeoutSeconds: 90,
    requestCircuitBreakerSeconds: 90,
    temperature: 0.15,
    maintenanceOutputFormat: 'dsl',
    repairMalformedJson: true,
    autoRebuildOnHistoryChange: true,
    autoRebuildMessageLimit: 120,
    customInstructions: '',
    // YAML added to story requests on Featherless or NovelAI (blank = thinking off, the preset's top_k and min_p).
    storyProviderBody: '',
    worldProgressionEnabled: true,
    progressionEveryAssistantTurns: 2,
    progressionAutonomy: 'conservative',
    progressionTimeMode: 'balanced',
    progressionConnectionProfileId: '',
    progressionFallbackConnectionProfileId: '',
    progressionMaximumResponseTokens: 10_000,
    progressionRequestTimeoutSeconds: 90,
    progressionTemperature: 0.1,
    progressionMaximumGoals: 40,
    progressionMaximumProcesses: 40,
    progressionMaximumEvents: 50,
    progressionMaximumInjectedEntries: 8,
    progressionInjectionBudget: 5_000,
    progressionRebuildBatchMessages: 30,
    triggerDeliveryMaximumAttempts: 3,
    triggerAttemptPreviewMaximum: 8,
    progressionCustomInstructions: '',
    automaticEventDirectorEnabled: false,
    automaticEventDirectorMode: 'auto_arm',
    automaticEventDirectorActivity: 'balanced',
    automaticEventDirectorMinimumConfidence: 0.82,
    automaticEventDirectorIncludePrivateMinds: false,
    automaticEventDirectorExpirationTurns: 40,
    // Game system: the ledger keeps money, belongings, object whereabouts,
    // prices, standing and reputation from each reply; the scene planner
    // prepares people, objects and prices for where the player is and can go.
    gameEnabled: true,
    gameLedgerEnabled: true,
    gameConnectionProfileId: '',
    gameMaximumResponseTokens: 4_000,
    gameTemperature: 0.1,
    gameCustomInstructions: '',
    gameInjectionBudget: 3_000,
    // The story model asks the game system to buy, sell, give, take, pay or
    // use up things through tools (or writes the call as text when its
    // provider has no tool parser); the game applies it and the model narrates
    // the result. Trade-screen buttons are applied the same way when sent.
    gameToolsEnabled: true,
    gameToolsSetupVersion: 0,
    scenePlannerEnabled: true,
    scenePlannerPrefetch: true,
    // On a provider that serves one request at a time, the story stops the running pass (it re-runs after the reply).
    storyPreemptsBackground: true,
    scenePlannerMaximumPlaces: 2,
    scenePlannerStaleHours: 8,
    // When the newest player turn heads for a place with nothing prepared,
    // prepare it before the story arrives there, waiting up to this long.
    scenePlannerAtSend: true,
    scenePlannerSendWaitSeconds: 60,
    plannerConnectionProfileId: '',
    plannerMaximumResponseTokens: 6_000,
    // A profile here splits the curator: people, places and whereabouts stay
    // on the curator profile, NPC minds go to this one, side by side.
    mindsConnectionProfileId: '',
    // Background help for smaller models (list-first ledger, code-found hints,
    // evidence check, identity and coverage hints, lenient progression): auto
    // turns it on for models under 70B by name and for unnamed sizes on a
    // one-request-at-a-time provider (NovelAI's GLM 4.6); Claude stays plain.
    assistedBackground: 'auto',
    plannerTemperature: 0.7,
    plannerCustomInstructions: '',
    // NPC portraits, drawn by an image server that speaks the Stable Diffusion
    // WebUI API (Local Dream through LDBridge); an empty URL means the server
    // SillyTavern's own image generation uses.
    portraitsEnabled: true,
    portraitServerUrl: '',
    portraitStyle: PORTRAIT_DEFAULTS.style,
    portraitNegative: PORTRAIT_DEFAULTS.negative,
    portraitSteps: PORTRAIT_DEFAULTS.steps,
    portraitCfg: PORTRAIT_DEFAULTS.cfg,
    // The people here as a row of cards under the top bar.
    castCardsEnabled: true,
    // Voice narration through InnerLore's local voice server (server/tts):
    // the narration in one voice, every person's lines in their own.
    voiceEnabled: true,
    voiceAutoPlay: true,
    voiceServerUrl: '',
    voiceNarrator: 's1',
    // '' = chosen from the persona's gender.
    voicePlayer: '',
    voiceUnknown: 's3',
    // How strongly a line's tone colours the sound (breath, tremor...): 0 off, 1 normal.
    voiceEmotion: 1,
    // Semitones a child's voice is raised by (the voice packs have no child voices); 0 turns it off.
    voiceChildPitch: 3,
    // Voice model generation: flow-matching steps (0 = the model's default) and the pause scale at punctuation.
    voiceSteps: 0,
    voiceSilence: 0,
    // Takes the voice server draws for a lively line (excited, angry, afraid...), keeping the one with the wider
    // intonation; 1 = one take (measured: a second adds almost nothing). Every short clip is redrawn anyway when its
    // pitch strays from the voice's own, which is what keeps a voice sounding like one person.
    voiceTakes: 1,
    voiceSpeed: 1,
    voiceDialogue: true,
    voiceNarration: true,
    // Read along while the reply streams; skip bare "she said" tags; pause between clips (ms).
    voiceStreaming: true,
    voiceSkipTags: true,
    voiceGapMs: 140,
    // Voice input: a microphone by the send box; speech becomes text through
    // the voice server's recognizer (or the browser's own), into the message
    // box or sent at once.
    voiceInputEnabled: true,
    voiceInputProvider: 'local',
    voiceInputMode: 'box',
    voiceInputLanguage: 'en-US',
    // Live chat: after speaking, the words are sent, and once the reply (and
    // its narration) is done the microphone listens again by itself.
    voiceLive: false,
    // Italic passages: the player's thoughts in their voice, other asides in
    // a quieter aside voice; 'narrator' reads them like narration; 'skip' leaves them out.
    voiceItalics: 'thought',
    voiceThought: '',
    // The story model writes a hidden [[Name|tone]] tag before each spoken
    // line, thought and change of mood; the reader never sees them.
    voiceTags: true,
    // Send the curator, progression, game ledger and scene planner at once
    // instead of one after another (for the Claude bridge's agent pool, or a
    // provider that serves several requests at a time).
    parallelBackgroundPasses: false,
    lorebookRegistry: {},
    pendingChatCleanups: {},
    storageBackend: 'sqlite',
    storageApiRoot: '/api/plugins/innerlore-storage/v1',
    storageRegistry: {},
    pendingStorageCleanups: {},
    debug: false,
});

const embeddedStorageClient = new EmbeddedStorageClient();

function activeStorageClient() {
    return getSettings().storageBackend === 'sqlite' ? storageClient : embeddedStorageClient;
}

const runtime = {
    choicesHidden: false,
    choicesSignature: '',
    lastFilledChoice: '',
    processing: false,
    rebuilding: false,
    queued: false,
    controller: null,
    historyTimer: null,
    retryTimer: null,
    historyRebuildQueued: false,
    historyRevision: 0,
    historyFallbackStore: null,
    historyFallbackChatId: '',
    historyFallbackBoundary: -1,
    deferHistoryRebuild: false,
    preparingFoundation: false,
    foundationPromise: null,
    foundationChatId: '',
    foundationTimer: null,
    afterStory: new Map(),
    afterStoryWaiter: null,
    storyGenerationBlock: null,
    blockedGenerationCancellation: false,
    cutoffRecovery: false,
    userStoppedGenerationAt: 0,
    statusKind: 'idle',
    statusLabel: 'Idle',
    statusDetail: 'Waiting for a chat.',
    selectedEntityId: '',
    selectedBrainId: '',
    brainView: 'visual',
    brainJsonDirty: false,
    selectedTriggerEventId: '',
    selectedEventProposalId: '',
    lastInjection: '',
    lastTurnContract: '',
    lastTriggerDeliveryPrompt: '',
    storyGenerationSerial: 0,
    activeStoryGenerationId: '',
    lastContextDiagnostics: '',
    lastCompilation: null,
    localContext: null,
    preparedContext: null,
    activeContextKey: '',
    contextPreparation: null,
    contextPreparationError: '',
    contextProfiles: Object.entries(BUILTIN_CONTEXT_PROFILES).map(([id, config]) => ({
        id,
        name: `${id[0].toUpperCase()}${id.slice(1)}`,
        builtin: true,
        revision: 0,
        config,
    })),
    store: null,
    storeChatId: '',
    storageWorldId: '',
    storageRevision: 0,
    storageSnapshotHash: '',
    storageReady: false,
    storageError: '',
    storageLoadGeneration: 0,
    storageSaveChain: Promise.resolve(),
    eventsRegistered: false,
    serverInitializationStarted: false,
    serverInitializationPromise: null,
};

const storageClient = new InnerLoreStorageClient({
    getHeaders: () => context().getRequestHeaders?.() || { 'Content-Type': 'application/json' },
});

function attachTransientStoreFacade(pointer) {
    if (!isInnerLoreStoragePointer(pointer) || !runtime.store) return pointer;
    for (const key of Object.keys(runtime.store)) {
        if (Object.hasOwn(pointer, key)) continue;
        Object.defineProperty(pointer, key, {
            configurable: true,
            enumerable: false,
            get: () => runtime.store?.[key],
            set: value => {
                if (runtime.store) runtime.store[key] = value;
            },
        });
    }
    return pointer;
}

function clearHistoryFallback() {
    runtime.historyFallbackStore = null;
    runtime.historyFallbackChatId = '';
    runtime.historyFallbackBoundary = -1;
    runtime.deferHistoryRebuild = false;
}

function context() {
    return SillyTavern.getContext();
}

function clone(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function normalizedLorebookNames(value) {
    const names = Array.isArray(value) ? value : (value ? [value] : []);
    return [...new Set(names.map(name => cleanString(name, 180)).filter(Boolean))].slice(0, 20);
}

function normalizeCleanupRegistry(value) {
    const registry = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = {};
    for (const [rawChatId, names] of Object.entries(registry).slice(0, 2_000)) {
        const chatId = cleanString(rawChatId, 300);
        const normalizedNames = normalizedLorebookNames(names);
        if (chatId) normalized[chatId] = normalizedNames;
    }
    return normalized;
}

function normalizeStorageRegistry(value) {
    const registry = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = {};
    for (const [rawChatId, rawWorldId] of Object.entries(registry).slice(0, 5_000)) {
        const chatId = cleanString(rawChatId, 300);
        const worldId = cleanString(rawWorldId, 64).toLocaleLowerCase();
        if (chatId && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(worldId)) normalized[chatId] = worldId;
    }
    return normalized;
}

function getSettings() {
    const extensionSettings = context().extensionSettings;
    if (!extensionSettings[MODULE_KEY] || typeof extensionSettings[MODULE_KEY] !== 'object') {
        extensionSettings[MODULE_KEY] = clone(defaultSettings);
    }
    const settings = extensionSettings[MODULE_KEY];
    const hadContextSizingVersion = Object.hasOwn(settings, 'contextSizingVersion');
    // Upgrade the former call-every-turn defaults once. Explicit custom
    // cadences are preserved, while installations still on the old defaults
    // receive the lower-cost adaptive policy.
    if (!Object.hasOwn(settings, 'maintenanceSchedulingVersion')) {
        if (Number(settings.processEveryAssistantTurns) === 1) settings.processEveryAssistantTurns = 3;
        if (Number(settings.progressionEveryAssistantTurns) === 2) settings.progressionEveryAssistantTurns = 4;
        settings.maintenanceSchedulingVersion = 1;
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) settings[key] = clone(value);
    }
    if (!hadContextSizingVersion) {
        const matchesFormerDefaults = Number(settings.sceneInjectionBudget) === 1_200
            && Number(settings.brainInjectionBudget) === 6_000
            && Number(settings.loreInjectionBudget) === 8_000
            && Number(settings.progressionInjectionBudget) === 5_000
            && Number(settings.maximumActiveBrains) === 12
            && Number(settings.maximumInjectedThoughtsPerBrain) === 6
            && Number(settings.maximumInjectedEntities) === 8
            && Number(settings.progressionMaximumInjectedEntries) === 8;
        if (matchesFormerDefaults && BUILTIN_CONTEXT_PROFILES[settings.contextProfileId || 'balanced']) {
            applyContextProfileToSettings(
                settings,
                contextProfileById(settings.contextProfileId || 'balanced', runtime.contextProfiles),
            );
        } else {
            settings.contextBudgetMode = 'custom';
            settings.contextMaximumCharacters = Math.max(
                2_000,
                Number(settings.sceneInjectionBudget || 0)
                    + Number(settings.brainInjectionBudget || 0)
                    + Number(settings.loreInjectionBudget || 0)
                    + Number(settings.progressionInjectionBudget || 0),
            );
        }
        settings.contextSizingVersion = CONTEXT_CONFIGURATION_VERSION;
    }
    settings.enabledEntityTypes = uniqueStrings(settings.enabledEntityTypes)
        .filter(type => ENTITY_TYPES.includes(type));
    if (!settings.enabledEntityTypes.length) settings.enabledEntityTypes = [...ENTITY_TYPES];
    settings.lorebookRegistry = normalizeCleanupRegistry(settings.lorebookRegistry);
    settings.pendingChatCleanups = normalizeCleanupRegistry(settings.pendingChatCleanups);
    settings.storageRegistry = normalizeStorageRegistry(settings.storageRegistry);
    settings.pendingStorageCleanups = normalizeStorageRegistry(settings.pendingStorageCleanups);
    if (!['automatic', 'macro'].includes(settings.contextDeliveryMode)) settings.contextDeliveryMode = 'automatic';
    if (!['json', 'dsl'].includes(settings.maintenanceOutputFormat)) settings.maintenanceOutputFormat = 'dsl';
    settings.providerConcurrency = providerConcurrency(settings);
    settings.contextProfileId = cleanString(settings.contextProfileId, 64).toLocaleLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(settings.contextProfileId)) settings.contextProfileId = 'balanced';
    // Derived budgets are the always-on behavior; the mode is pinned and the
    // legacy profile/custom values survive only as the pre-measurement fallback.
    settings.contextBudgetMode = 'derived';
    settings.contextMaximumCharacters = Math.min(100_000, Math.max(
        2_000,
        Number(settings.contextMaximumCharacters) || 18_000,
    ));
    settings.contextGraphDepth = Number(settings.contextGraphDepth) > 0 ? 1 : 0;
    settings.serverContextTimeoutMs = Math.min(5_000, Math.max(250, Number(settings.serverContextTimeoutMs) || 1_200));
    if (!['review', 'auto_arm'].includes(settings.automaticEventDirectorMode)) {
        settings.automaticEventDirectorMode = 'auto_arm';
    }
    if (!['quiet', 'balanced', 'lively'].includes(settings.automaticEventDirectorActivity)) {
        settings.automaticEventDirectorActivity = 'balanced';
    }
    settings.automaticEventDirectorMinimumConfidence = Math.min(1, Math.max(
        0.5,
        Number(settings.automaticEventDirectorMinimumConfidence) || 0.82,
    ));
    settings.automaticEventDirectorExpirationTurns = Math.min(200, Math.max(
        4,
        Math.round(Number(settings.automaticEventDirectorExpirationTurns) || 40),
    ));
    if (!settings.progressionConnectionProfileId) {
        settings.progressionConnectionProfileId = settings.connectionProfileId || chooseDefaultProfileId('');
    }
    return settings;
}

function saveSettings() {
    context().saveSettingsDebounced();
}

function rememberLorebook(store) {
    const chatId = cleanString(store?.chatId, 300);
    const lorebookName = cleanString(store?.lorebookName, 180);
    if (!chatId || !lorebookName) return;
    const settings = getSettings();
    const existing = normalizedLorebookNames(settings.lorebookRegistry[chatId]);
    if (existing.includes(lorebookName)) return;
    settings.lorebookRegistry[chatId] = normalizedLorebookNames([...existing, lorebookName]);
    saveSettings();
}

async function syncLorebook(store, options = {}) {
    const result = await syncNativeLorebook(store, options);
    rememberLorebook(store);
    return result;
}

function migrateLorebookRegistry(oldChatId, newChatId) {
    const oldId = cleanString(oldChatId, 300);
    const newId = cleanString(newChatId, 300);
    if (!oldId || !newId || oldId === newId) return;
    const settings = getSettings();
    const oldSuffix = ` - ${hashString(oldId)}`;
    const discovered = (context().getWorldInfoNames?.() || [])
        .filter(name => name.startsWith('InnerLore - ') && name.endsWith(oldSuffix));
    const names = normalizedLorebookNames([
        ...normalizedLorebookNames(settings.lorebookRegistry[oldId]),
        ...normalizedLorebookNames(settings.lorebookRegistry[newId]),
        ...discovered,
    ]);
    if (names.length) settings.lorebookRegistry[newId] = names;
    delete settings.lorebookRegistry[oldId];
    saveSettings();
}

async function migrateStorageRegistry(oldChatId, newChatId) {
    const oldId = cleanString(oldChatId, 300);
    const newId = cleanString(newChatId, 300);
    if (!oldId || !newId || oldId === newId) return null;
    const ctx = context();
    const settings = getSettings();
    const pointer = isInnerLoreStoragePointer(ctx.chatMetadata?.[MODULE_KEY])
        ? ctx.chatMetadata[MODULE_KEY]
        : null;
    const worldId = settings.storageRegistry[oldId]
        || (pointer?.chatId === oldId ? pointer.worldId : '')
        || (runtime.storeChatId === oldId ? runtime.storageWorldId : '');
    if (!worldId) return null;

    const expectedRevision = runtime.storeChatId === oldId && runtime.storageWorldId === worldId
        ? runtime.storageRevision
        : undefined;
    const result = await activeStorageClient().rename(worldId, newId, expectedRevision);
    delete settings.storageRegistry[oldId];
    delete settings.pendingStorageCleanups[oldId];
    settings.storageRegistry[newId] = worldId;
    saveSettings();
    ctx.chatMetadata[MODULE_KEY] = attachTransientStoreFacade(createInnerLoreStoragePointer(result));
    await ctx.saveMetadata();
    if (runtime.storeChatId === oldId && runtime.storageWorldId === worldId) {
        runtime.store = normalizeStore(result.store, newId);
        runtime.storeChatId = newId;
        runtime.storageRevision = result.revision;
        runtime.storageSnapshotHash = result.snapshotHash;
    }
    return result;
}

async function cleanupDeletedChat(chatId, { silent = false } = {}) {
    const id = cleanString(chatId, 300);
    if (!id) return { candidates: [], deleted: [], failed: [] };

    const ctx = context();
    const metadataValue = ctx.chatMetadata?.[MODULE_KEY];
    const activeStore = runtime.storeChatId === id ? runtime.store : (isLegacyInnerLoreStore(metadataValue) ? metadataValue : null);
    const activePointer = isInnerLoreStoragePointer(metadataValue) ? metadataValue : null;
    const activeWorldId = runtime.storeChatId === id ? runtime.storageWorldId : '';
    const deletingActiveStore = runtime.storeChatId === id
        || cleanString(activeStore?.chatId, 300) === id
        || cleanString(activePointer?.chatId, 300) === id;
    if (deletingActiveStore) {
        runtime.controller?.abort();
        clearAnalysisRetry();
        clearTimeout(runtime.historyTimer);
        runtime.historyTimer = null;
        clearTimeout(runtime.foundationTimer);
        runtime.foundationTimer = null;
        runtime.historyRebuildQueued = false;
        runtime.queued = false;
        delete ctx.chatMetadata[MODULE_KEY];
        ctx.setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0);
        ctx.setExtensionPrompt(TURN_CONTRACT_PROMPT_KEY, '', 1, 0, false, 0);
        ctx.setExtensionPrompt(TRIGGER_DELIVERY_PROMPT_KEY, '', 1, 0, false, 0);
        ctx.setExtensionPrompt(TEXT_MEMORY_PROMPT_KEY, '', 0, 0, false, 0);
        runtime.lastTextMemory = '';
        runtime.lastInjection = '';
        runtime.lastTurnContract = '';
        runtime.lastTriggerDeliveryPrompt = '';
        runtime.lastCompilation = null;
        runtime.localContext = null;
        runtime.preparedContext = null;
        runtime.activeContextKey = '';
        runtime.contextPreparation?.controller?.abort();
        runtime.contextPreparation = null;
        runtime.contextPreparationError = '';
        runtime.activeStoryGenerationId = '';
        runtime.selectedEntityId = '';
        runtime.selectedBrainId = '';
        runtime.selectedTriggerEventId = '';
        runtime.store = null;
        runtime.storeChatId = '';
        runtime.storageWorldId = '';
        runtime.storageRevision = 0;
        runtime.storageSnapshotHash = '';
        runtime.storageReady = false;
    }

    const settings = getSettings();
    const storageWorldId = settings.pendingStorageCleanups[id]
        || settings.storageRegistry[id]
        || (activePointer?.chatId === id ? activePointer.worldId : '')
        || activeWorldId
        || await innerLoreWorldId(id);
    const expectedSuffix = ` - ${hashString(id)}`;
    const discoveredNames = (ctx.getWorldInfoNames?.() || [])
        .filter(name => name.startsWith('InnerLore - ') && name.endsWith(expectedSuffix));
    const registeredNames = normalizedLorebookNames([
        ...normalizedLorebookNames(settings.lorebookRegistry[id]),
        ...normalizedLorebookNames(settings.pendingChatCleanups[id]),
        deletingActiveStore ? cleanString(activeStore?.lorebookName, 180) : '',
        ...discoveredNames,
    ]);

    // Record the cleanup before attempting it. If SillyTavern closes or the
    // World Info request fails, initialization will retry these exact names.
    settings.pendingChatCleanups[id] = registeredNames;
    settings.pendingStorageCleanups[id] = storageWorldId;
    delete settings.lorebookRegistry[id];
    saveSettings();

    let loreResult = { candidates: registeredNames, deleted: [], failed: registeredNames };
    let storageResult = null;
    let storageError = null;
    try {
        loreResult = await deleteInnerLorebooksForChat(id, { registeredNames });
        if (loreResult.failed.length) {
            settings.pendingChatCleanups[id] = normalizedLorebookNames(loreResult.failed);
            saveSettings();
            if (!silent) {
                toastr.warning(`The chat was deleted, but ${loreResult.failed.length} InnerLore lorebook${loreResult.failed.length === 1 ? '' : 's'} could not be removed yet. Cleanup will retry automatically.`, DISPLAY_NAME);
            }
        } else {
            delete settings.pendingChatCleanups[id];
        }
    } catch (error) {
        settings.pendingChatCleanups[id] = registeredNames;
        console.error(`${LOG_PREFIX} Could not remove generated lorebooks for ${id}:`, error);
    }

    try {
        storageResult = await activeStorageClient().deleteWorld(id, storageWorldId);
        delete settings.pendingStorageCleanups[id];
        delete settings.storageRegistry[id];
    } catch (error) {
        storageError = error;
        settings.pendingStorageCleanups[id] = storageWorldId;
        console.error(`${LOG_PREFIX} Could not permanently delete the SQLite world for ${id}:`, error);
        if (!silent) toastr.warning('The chat was deleted, but its InnerLore SQLite world could not be permanently deleted yet. Cleanup will retry automatically.', DISPLAY_NAME);
    }
    saveSettings();

    // The chat's portrait files. A failure here is retried by the startup
    // sweep, which removes every file whose chat no longer exists.
    let portraitResult = { candidates: [], deleted: [], failed: [] };
    try {
        portraitResult = await deleteChatPortraits(id);
    } catch (error) {
        console.error(`${LOG_PREFIX} Could not remove the portraits of ${id}:`, error);
        portraitResult.failed = ['(listing failed)'];
    }
    if (portraitResult.failed.length && !silent) {
        toastr.warning('The chat was deleted, but its InnerLore portraits could not all be removed yet. The next start will retry.', DISPLAY_NAME);
    }
    log('Cleaned deleted chat state', id, { ...loreResult, storage: storageResult, portraits: portraitResult });
    return { ...loreResult, storage: storageResult, storageError: storageError?.message || '', portraits: portraitResult };
}

/**
 * Chats that no longer exist but still have InnerLore state: lorebooks and
 * SQLite worlds left by deletions InnerLore never saw (a character deleted
 * with its chats, a file removed by hand, an older version). Every
 * character's chats are listed; a registered chat outside that list, or a
 * managed lorebook whose chat is outside it, is cleaned up. A failed listing
 * cancels the sweep, so nothing is removed on a guess.
 */
async function sweepOrphanedChatState() {
    const ctx = context();
    const settings = getSettings();
    const existing = new Set();
    for (const character of ctx.characters || []) {
        if (!character?.avatar) continue;
        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: ctx.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: character.avatar, simple: true }),
        });
        if (!response.ok) throw new Error(`chat listing failed for ${character.name}: HTTP ${response.status}`);
        const list = await response.json();
        for (const item of Array.isArray(list) ? list : []) {
            const id = cleanString(item?.file_id || item?.file_name, 300).replace(/\.jsonl$/u, '');
            if (id) existing.add(id);
        }
    }
    for (const group of ctx.groups || []) for (const chatId of group?.chats || []) existing.add(cleanString(chatId, 300));
    // Nothing to compare against (no characters loaded): sweep nothing.
    if (!(ctx.characters || []).length && !(ctx.groups || []).length) return { swept: [], existing: 0, skipped: 'no characters' };
    const current = currentChatId();
    const alive = id => !id || id === current || existing.has(id);
    const orphans = new Set([
        ...Object.keys(settings.storageRegistry),
        ...Object.keys(settings.lorebookRegistry),
        ...Object.keys(settings.pendingChatCleanups),
        ...Object.keys(settings.pendingStorageCleanups),
    ].filter(id => !alive(id)));
    // Managed lorebooks the registries forgot.
    for (const name of ctx.getWorldInfoNames?.() || []) {
        if (!name.startsWith('InnerLore - ')) continue;
        let data = null;
        try { data = await ctx.loadWorldInfo?.(name); } catch { continue; }
        const owner = lorebookOwnerChatId(data);
        if (owner && !alive(owner)) orphans.add(owner);
    }
    const swept = [];
    for (const id of orphans) {
        try {
            await cleanupDeletedChat(id, { silent: true });
            swept.push(id);
        } catch (error) {
            console.warn(`${LOG_PREFIX} Orphan sweep could not clean ${id}:`, error);
        }
    }
    if (swept.length) console.info(`${LOG_PREFIX} Removed InnerLore state of ${swept.length} deleted chat(s): ${swept.join(', ')}`);
    // Portrait files no existing chat could have drawn: left by chats deleted
    // elsewhere, by a deletion whose file removal failed, or by a rename.
    let portraits = { candidates: [], deleted: [], failed: [] };
    try {
        portraits = await deletePortraitFiles(orphanPortraitFiles(await listPortraitFiles(), [...existing, current]));
        if (portraits.deleted.length) console.info(`${LOG_PREFIX} Removed ${portraits.deleted.length} portrait file(s) of deleted chats: ${portraits.deleted.join(', ')}`);
    } catch (error) {
        console.warn(`${LOG_PREFIX} Orphan sweep could not check the portrait files:`, error);
    }
    return { swept, existing: existing.size, portraits };
}

async function retryPendingChatCleanups() {
    const settings = getSettings();
    const chatIds = [...new Set([
        ...Object.keys(settings.pendingChatCleanups),
        ...Object.keys(settings.pendingStorageCleanups),
    ])];
    for (const chatId of chatIds) await cleanupDeletedChat(chatId, { silent: true });
}

function log(...args) {
    if (getSettings().debug) console.debug(LOG_PREFIX, ...args);
}

/**
 * Background help for smaller models (list-first ledger, code-found hints,
 * evidence check): on for a profile's model under 70B by its name (Gemma 4
 * 31B, Qwen 27B), off for large or unnamed ones (Claude, GLM 4.6), unless
 * the setting forces it.
 */
function assistedFor(profileId) {
    const mode = getSettings().assistedBackground || 'auto';
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    const profile = findConnectionProfile(profileId);
    const size = modelSizeBillions(profile?.model);
    return size < 70 || (!Number.isFinite(size) && Boolean(oneAtATimeProvider(profileId)));
}

/** The story is written by a text-completion model (NovelAI, KoboldAI, text-generation-webui). */
function storyIsTextCompletion() {
    return isTextCompletionApi(context().mainApi);
}

function currentChatId() {
    const ctx = context();
    return cleanString(ctx.getCurrentChatId?.() || ctx.chatId, 300);
}

function resetLorebookLinks(store) {
    store.lorebookName = '';
    for (const record of Object.values(store.entities || {})) {
        record.entryUid = null;
        record.renderedHash = '';
    }
}

function getChatStore(options = {}) {
    const ctx = context();
    const chatId = currentChatId();
    if (!chatId || !runtime.storageReady || runtime.storeChatId !== chatId || !runtime.store) return null;
    const hadStore = true;
    const existingStore = runtime.store;
    const storedVersion = Number(existingStore?.version) || 0;
    const hadProgression = Boolean(existingStore?.progression && typeof existingStore.progression === 'object');
    const normalized = normalizeStore(existingStore, chatId);
    // Preserve object identity while a background request is in flight. Event
    // handlers may ask for the store during that request; replacing the object
    // would otherwise leave the completed pass writing into a stale reference.
    let store = normalized;
    if (hadStore && existingStore && typeof existingStore === 'object') {
        Object.assign(existingStore, normalized);
        store = existingStore;
    }

    if (store.chatId && store.chatId !== chatId) {
        // Branches inherit useful state, but receive a separate generated book.
        store.chatId = chatId;
        resetLorebookLinks(store);
        store.lastProcessedIndex = Math.min(store.lastProcessedIndex, ctx.chat.length - 1);
        store.processedFingerprints = {};
        store.progression = normalizeProgressionState(store.progression);
        store.progression.lastProcessedIndex = Math.min(store.progression.lastProcessedIndex, ctx.chat.length - 1);
        store.progression.processedFingerprints = {};
        store.assistantTurnsSincePass = 0;
        store.updatedAt = Date.now();
        options.onChanged?.();
    } else {
        store.chatId = chatId;
    }

    store.progression = normalizeProgressionState(store.progression);
    if (hadStore && !hadProgression) {
        // Upgrading an established chat must not silently launch dozens of
        // historical model calls. Rebuild From Chat remains the explicit
        // backfill path; live progression begins at the current watermark.
        store.progression.lastProcessedIndex = store.lastProcessedIndex;
    }
    // SillyTavern normally emits edit/swipe/delete events, but a selected
    // message can also change while the extension is unloaded (for example,
    // through an external repair or restored chat file). Compare every saved
    // processed fingerprint on load so stale minds, lore, and progression are
    // quarantined rather than silently surviving the changed history.
    const curatorHistoryTracked = Object.keys(store.processedFingerprints || {}).length > 0;
    const progressionHistoryTracked = Object.keys(store.progression.processedFingerprints || {}).length > 0;
    const savedHistoryChanged = hadStore && !store.needsRebuild && (
        (curatorHistoryTracked && !messageRangeMatchesSnapshot(ctx.chat, store.processedFingerprints))
        || (progressionHistoryTracked && !messageRangeMatchesSnapshot(ctx.chat, store.progression.processedFingerprints))
    );
    if (savedHistoryChanged) {
        store.needsRebuild = true;
        store.updatedAt = Date.now();
        options.onChanged?.();
    }

    // Expression readiness is independent from objective continuity. An old
    // mind now receives a focused card-backed warm-up instead of quarantining
    // otherwise valid lore and launching a full history/progression rebuild.

    runtime.store = store;
    runtime.storeChatId = chatId;
    if (hadStore && storedVersion !== store.version) options.onChanged?.();
    rememberLorebook(store);
    return store;
}

function createInitialChatStore(chatId, legacyValue = null) {
    const ctx = context();
    const hadLegacy = isLegacyInnerLoreStore(legacyValue);
    const legacyHadProgression = Boolean(legacyValue?.progression && typeof legacyValue.progression === 'object');
    const store = normalizeStore(hadLegacy ? legacyValue : createEmptyStore(chatId), chatId);

    if (!hadLegacy) {
        // A trailing player message has not been completed until the story
        // model answers it. Keeping the watermark on the last completed story
        // reply ensures that action is included with its eventual response.
        const completedIndex = lastCompletedStoryIndex(ctx.chat);
        // A fresh greeting is intentionally curated; an established chat with
        // no InnerLore state starts at the current watermark to avoid an
        // unexpected historical model bill.
        const freshGreetingOnly = ctx.chat.length === 1
            && completedIndex === 0
            && !ctx.chat[0]?.is_user
            && !ctx.chat[0]?.is_system;
        store.lastProcessedIndex = freshGreetingOnly ? -1 : completedIndex;
        store.progression = createProgressionState();
        store.progression.lastProcessedIndex = store.lastProcessedIndex;
        store.chatId = chatId;
        seedNewStoreFromCard(store);
    } else if (store.chatId && store.chatId !== chatId) {
        // Legacy metadata is cloned by SillyTavern when a chat is branched.
        // Apply the same branch quarantine before its first SQLite commit.
        store.chatId = chatId;
        resetLorebookLinks(store);
        store.lastProcessedIndex = Math.min(store.lastProcessedIndex, ctx.chat.length - 1);
        store.processedFingerprints = {};
        store.progression = normalizeProgressionState(store.progression);
        store.progression.lastProcessedIndex = Math.min(store.progression.lastProcessedIndex, ctx.chat.length - 1);
        store.progression.processedFingerprints = {};
        store.assistantTurnsSincePass = 0;
        store.updatedAt = Date.now();
    } else {
        store.chatId = chatId;
    }

    store.progression = normalizeProgressionState(store.progression);
    if (hadLegacy && !legacyHadProgression) store.progression.lastProcessedIndex = store.lastProcessedIndex;
    if (!hadLegacy && store.progression.lastProcessedIndex < store.lastProcessedIndex) {
        store.progression.lastProcessedIndex = store.lastProcessedIndex;
    }
    return store;
}

function storagePointerMatches(left, right) {
    return isInnerLoreStoragePointer(left)
        && left.worldId === right.worldId
        && left.chatId === right.chatId;
}

async function loadChatStore() {
    const ctx = context();
    const chatId = currentChatId();
    const generation = ++runtime.storageLoadGeneration;
    // Finish any already-queued commit for the chat being left before swapping
    // the in-memory cache to a different world.
    await runtime.storageSaveChain.catch(() => {});
    if (generation !== runtime.storageLoadGeneration || chatId !== currentChatId()) return null;
    runtime.storageReady = false;
    runtime.storageError = '';
    runtime.store = null;
    runtime.storeChatId = '';
    runtime.storageWorldId = '';
    runtime.storageRevision = 0;
    runtime.storageSnapshotHash = '';
    runtime.contextPreparation?.controller?.abort();
    runtime.contextPreparation = null;
    runtime.preparedContext = null;
    runtime.localContext = null;
    runtime.lastCompilation = null;
    runtime.activeContextKey = '';
    runtime.contextPreparationError = '';
    if (!chatId) return null;

    const settings = getSettings();
    const metadataValue = ctx.chatMetadata?.[MODULE_KEY];
    let metadataPointerValue = isInnerLoreStoragePointer(metadataValue) ? metadataValue : null;
    const registeredWorldId = settings.storageRegistry[chatId];
    const registryPointer = registeredWorldId ? {
        backend: 'airpg-storage',
        pointerVersion: 1,
        worldId: registeredWorldId,
        chatId,
    } : null;
    // A mismatched metadata pointer signals a real SillyTavern branch and must
    // win over the registry so the server can fork the source world. But
    // SillyTavern also clones chat metadata onto a brand-new chat started from
    // an open one. New worlds are strictly independent of old worlds: a
    // greeting-only chat never inherits InnerLore state - the cloned pointer
    // is deleted outright so no later path can fork, reuse, or compare against
    // the previous world - and the chat creates (and card-seeds) its own.
    const greetingOnlyChat = Array.isArray(ctx.chat)
        && ctx.chat.length === 1
        && !ctx.chat[0]?.is_user
        && !ctx.chat[0]?.is_system;
    if (greetingOnlyChat && metadataPointerValue?.chatId && metadataPointerValue.chatId !== chatId) {
        try {
            delete ctx.chatMetadata[MODULE_KEY];
            ctx.saveChat?.();
        } catch (error) {
            console.error('[InnerLore] Could not strip inherited world state from a new chat:', error);
        }
        metadataPointerValue = null;
    }
    const pointer = !greetingOnlyChat && metadataPointerValue?.chatId && metadataPointerValue.chatId !== chatId
        ? metadataPointerValue
        : (registryPointer || metadataPointerValue);
    // A whole store kept in the chat file (the pre-storage format) migrates
    // into storage, unless it was cloned onto a brand-new chat from another.
    const inheritedLegacyStore = greetingOnlyChat && metadataValue?.chatId && metadataValue.chatId !== chatId;
    const legacyStore = !inheritedLegacyStore && isLegacyInnerLoreStore(metadataValue) ? metadataValue : null;
    const initialStore = createInitialChatStore(chatId, legacyStore);
    // Chats with existing SQLite worlds always keep using the server backend;
    // everything else follows the configured backend (embedded = standalone).
    runtime.storageBackendUsed = (settings.storageBackend === 'sqlite' || pointer)
        ? 'sqlite'
        : 'embedded';

    try {
        const result = await activeStorageClient().loadOrCreate({
            chatId,
            pointer: runtime.storageBackendUsed === 'sqlite' ? pointer : null,
            initialStore,
            migrationSource: legacyStore && runtime.storageBackendUsed === 'sqlite' ? 'legacy_chat_metadata' : null,
        });
        if (generation !== runtime.storageLoadGeneration || chatId !== currentChatId()) return null;

        runtime.store = normalizeStore(result.store, chatId);
        runtime.committedEntityCount = Object.keys(runtime.store?.entities || {}).length;
        runtime.storeChatId = chatId;
        // Self-healing seeds: a greeting-only chat re-seeds from its card on
        // every open. The merge is idempotent (keyed by entity name), so a
        // creation-time glitch that left the world empty or partial is
        // repaired the moment the chat is opened, without duplicating canon.
        if (Array.isArray(ctx.chat) && ctx.chat.length === 1 && !ctx.chat[0]?.is_user && !ctx.chat[0]?.is_system) {
            const seededNow = seedNewStoreFromCard(runtime.store);
            if (seededNow > 0) void saveChatStore({ allowEntityShrink: true }).catch(() => { /* heal retries on next open */ });
        }
        runtime.storageWorldId = result.worldId;
        runtime.storageRevision = result.revision;
        runtime.storageSnapshotHash = result.snapshotHash;
        runtime.storageReady = true;
        if (runtime.storageBackendUsed === 'embedded') {
            // Standalone mode: the full store lives in the chat's own metadata
            // (the legacy location), persisted with the chat file automatically.
            if (!isLegacyInnerLoreStore(metadataValue)) {
                ctx.chatMetadata[MODULE_KEY] = clone(runtime.store);
                await ctx.saveMetadata();
            }
            delete settings.storageRegistry[chatId];
            delete settings.pendingStorageCleanups[chatId];
            saveSettings();
        } else {
            const nextPointer = attachTransientStoreFacade(createInnerLoreStoragePointer(result));
            settings.storageRegistry[chatId] = result.worldId;
            delete settings.pendingStorageCleanups[chatId];
            saveSettings();

            // The server commit has completed. It is now safe to replace the old
            // multi-kilobyte chat JSON state with a small routing pointer.
            if (!storagePointerMatches(metadataValue, nextPointer)
                || metadataValue.revision !== nextPointer.revision
                || metadataValue.snapshotHash !== nextPointer.snapshotHash) {
                ctx.chatMetadata[MODULE_KEY] = nextPointer;
                await ctx.saveMetadata();
            } else {
                attachTransientStoreFacade(metadataValue);
            }
        }

        let changed = false;
        getChatStore({ onChanged: () => { changed = true; } });
        if (changed) await saveChatStore();
        if (result.projection?.ok === false) {
            console.warn(`${LOG_PREFIX} SQLite committed, but graph projection remains queued: ${result.projection.error}`);
        }
        await refreshContextProfiles();
        return runtime.store;
    } catch (error) {
        if (generation !== runtime.storageLoadGeneration) return null;
        runtime.storageError = cleanString(error?.message || String(error), 1_000);
        runtime.storageReady = false;
        throw error;
    }
}

/** Re-load the server's committed store for the current chat, replacing a
 *  stale in-memory snapshot instead of committing it. */
async function reloadCurrentChatStore() {
    try {
        const chatId = currentChatId();
        if (!chatId || !runtime.storageWorldId) return;
        // load() returns the stored record; the world itself is its store.
        const loaded = await activeStorageClient().load(runtime.storageWorldId);
        if (loaded?.store && loaded.chatId === chatId) {
            runtime.store = normalizeStore(loaded.store, chatId);
            runtime.committedEntityCount = Object.keys(runtime.store?.entities || {}).length;
            if (Number.isFinite(loaded.revision)) runtime.storageRevision = loaded.revision;
            updateUI();
        }
    } catch (error) {
        console.error('[InnerLore] Could not reload the committed store after blocking a shrinking save:', error);
    }
}

async function saveChatStore(options = {}) {
    const requestedChatId = currentChatId();
    if (!requestedChatId || !runtime.storageReady || runtime.storeChatId !== requestedChatId) return;
    const operation = async () => {
        if (!runtime.storageReady || runtime.storeChatId !== requestedChatId || !runtime.storageWorldId) return;
        const worldId = runtime.storageWorldId;
        const expectedRevision = runtime.storageRevision;
        // Shrink guard: a stale in-memory store captured before seeding or a
        // load must never silently replace a fuller committed world. Real
        // deletions pass allowEntityShrink explicitly (entity editor).
        const liveCount = Object.keys(runtime.store?.entities || {}).length;
        if (!options.allowEntityShrink
            && Number.isFinite(runtime.committedEntityCount)
            && liveCount < Math.floor(runtime.committedEntityCount * 0.7)) {
            console.warn(`[InnerLore] Blocked a save that would shrink the world from ${runtime.committedEntityCount} to ${liveCount} entities (stale store snapshot); reload your chat state instead of losing canon.`);
            await reloadCurrentChatStore();
            return;
        }
        const snapshot = clone(runtime.store);
        const branch = narrativeBranchDescriptor();
        const scene = narrativeScene(runtime.lastCompilation?.scene);
        const result = await activeStorageClient().save(worldId, requestedChatId, snapshot, {
            expectedRevision,
            branch,
            scene,
            observation: contextObservation(branch),
        });
        if (runtime.storeChatId === requestedChatId && runtime.storageWorldId === worldId) {
            runtime.storageRevision = result.revision;
            runtime.committedEntityCount = Object.keys(runtime.store?.entities || {}).length;
            updateCastCards();
            runtime.storageSnapshotHash = result.snapshotHash;
            runtime.preparedContext = null;
            const pointer = context().chatMetadata?.[MODULE_KEY];
            if (isInnerLoreStoragePointer(pointer) && pointer.worldId === worldId) {
                // Keep the in-memory pointer current. Normal SillyTavern chat
                // saves may persist it, but InnerLore no longer writes the chat
                // JSON file for every state mutation.
                pointer.revision = result.revision;
                pointer.snapshotHash = result.snapshotHash;
                pointer.updatedAt = result.updatedAt;
            }
            if (result.projection?.ok === false) {
                console.warn(`${LOG_PREFIX} SQLite committed, but graph projection remains queued: ${result.projection.error}`);
            }
            updateInjection();
            void prepareServerContext();
        }
    };
    const queued = runtime.storageSaveChain.catch(() => {}).then(operation);
    runtime.storageSaveChain = queued;
    try {
        await queued;
    } catch (error) {
        runtime.storageError = cleanString(error?.message || String(error), 1_000);
        throw error;
    }
}

function expireAutomaticEventState(stateValue, branchId, currentMessageIndex, availableSourceIds = null) {
    let state = normalizeProgressionState(stateValue);
    const expiration = expireEventProposals(state, {
        branchId,
        currentMessageIndex,
        ...(availableSourceIds instanceof Set ? { availableSourceIds } : {}),
    });
    state = expiration.state;
    for (const item of expiration.expired) {
        if (!item.definitionId || state.eventDefinitions?.[item.definitionId]?.origin !== 'automatic_director') continue;
        state = removeTriggerEventDefinition(state, item.definitionId).state;
    }
    return { state, expired: expiration.expired };
}

async function persistProgressionReplacement(store, nextProgression) {
    const previous = store.progression;
    store.progression = nextProgression;
    try {
        await saveChatStore();
    } catch (error) {
        store.progression = previous;
        throw error;
    }
}

async function maybeRunAutomaticEventDirector({ force = false } = {}) {
    const settings = getSettings();
    const store = getChatStore();
    if (!store || !runtime.storageReady || !runtime.storageWorldId) return { skipped: true, reason: 'storage_unavailable' };
    const currentMessageIndex = lastCompletedStoryIndex(context().chat || []);
    const branch = narrativeBranchDescriptor();
    let progression = normalizeProgressionState(clone(store.progression));
    const initialExpiration = expireAutomaticEventState(progression, branch.id, currentMessageIndex);
    progression = initialExpiration.state;
    if (initialExpiration.expired.length) await persistProgressionReplacement(store, progression);

    const decision = decideAutomaticEventGeneration(progression, settings, currentMessageIndex, { force });
    if (!decision.due) return { skipped: true, ...decision, expired: initialExpiration.expired };

    const sourceRevision = runtime.storageRevision;
    const sourceWorldId = runtime.storageWorldId;
    const sourceHead = branch.headFingerprint;
    try {
        const directorContext = await activeStorageClient().buildEventDirectorContext(sourceWorldId, {
            expectedRevision: sourceRevision,
            branchId: branch.id,
            headFingerprint: sourceHead,
            includePrivateMinds: settings.automaticEventDirectorIncludePrivateMinds === true,
        }, { signal: runtime.controller?.signal });

        const messages = buildEventDirectorMessages({
            context: directorContext,
            playerName: context().name1,
            activity: settings.automaticEventDirectorActivity,
            includePrivateMinds: settings.automaticEventDirectorIncludePrivateMinds,
            minimumConfidence: settings.automaticEventDirectorMinimumConfidence,
        });
        const response = await requestEventDirectorProposal(
            settings,
            messages,
            runtime.controller?.signal,
            {
                state: progression,
                // A backend without director-context support returns null;
                // an empty catalog then cleanly yields no proposal instead of
                // crashing the director pass.
                sources: Array.isArray(directorContext?.sources) ? directorContext.sources : [],
                playerName: context().name1,
                minimumConfidence: settings.automaticEventDirectorMinimumConfidence,
                includePrivateMinds: settings.automaticEventDirectorIncludePrivateMinds,
                allowGeneratedLineage: false,
            },
        );
        if (runtime.storageWorldId !== sourceWorldId
            || runtime.storageRevision !== sourceRevision
            || narrativeBranchDescriptor().headFingerprint !== sourceHead) {
            return { skipped: true, reason: 'state_changed_during_generation', discarded: true };
        }

        progression = recordEventDirectorAttempt(progression, {
            currentMessageIndex,
            outcome: response.proposal ? 'proposed' : 'no_proposal',
            reason: response.reason,
            repaired: response.repaired,
        });
        if (!response.proposal) {
            await persistProgressionReplacement(store, progression);
            return { generated: false, reason: response.reason, repaired: response.repaired, decision };
        }

        const added = addEventProposal(progression, response.proposal, {
            sourceStoreRevision: sourceRevision,
            branchId: branch.id,
            headFingerprint: sourceHead,
            currentMessageIndex,
            expirationTurns: settings.automaticEventDirectorExpirationTurns,
            profileId: settings.progressionConnectionProfileId || settings.connectionProfileId || 'active',
        });
        progression = added.state;
        let definition = null;
        if (settings.automaticEventDirectorMode === 'auto_arm') {
            const armed = upsertTriggerEventDefinition(
                progression,
                eventDefinitionFromProposal(added.proposal),
                {
                    clock: progression.clock,
                    messageIndex: currentMessageIndex,
                    playerName: context().name1,
                },
            );
            progression = armed.state;
            definition = armed.definition;
            progression = markEventProposalArmed(progression, added.proposal.id, definition.id).state;
        }
        await persistProgressionReplacement(store, progression);
        runtime.selectedEventProposalId = added.proposal.id;
        return {
            generated: true,
            proposal: progression.eventProposals[added.proposal.id],
            definition,
            repaired: response.repaired,
            codec: codecStatsFromResponse(response),
            decision,
            expired: initialExpiration.expired,
        };
    } catch (error) {
        if (error?.name === 'AbortError' || runtime.controller?.signal.aborted) throw error;
        console.warn(`${LOG_PREFIX} Automatic Event Director deferred:`, error);
        try {
            const failed = recordEventDirectorAttempt(normalizeProgressionState(clone(store.progression)), {
                currentMessageIndex,
                outcome: 'error',
                error: error.message || String(error),
                reason: decision.reason,
            });
            await persistProgressionReplacement(store, failed);
        } catch (persistenceError) {
            console.warn(`${LOG_PREFIX} Could not persist Event Director diagnostics:`, persistenceError);
        }
        return { generated: false, error, decision };
    }
}

function setStatus(kind, label, detail = '') {
    runtime.statusKind = kind;
    runtime.statusLabel = label;
    runtime.statusDetail = detail;
    const badge = document.getElementById('il_status_badge');
    if (badge) {
        badge.className = `inner-lore-status is-${kind}`;
        badge.textContent = label;
    }
    const statusDetail = document.getElementById('il_status_detail');
    if (statusDetail) statusDetail.textContent = detail;
    const stopButton = document.getElementById('il_stop');
    if (stopButton) stopButton.disabled = !(runtime.processing || runtime.rebuilding || runtime.preparingFoundation);
}

function recentStoryText(maximumMessages = 16) {
    const chat = context().chat || [];
    return chat
        .slice(-Math.max(1, maximumMessages))
        .filter(message => message
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes))
        .map(message => cleanString(message.mes, 8_000))
        .join('\n\n');
}

function narrativeBranchDescriptor() {
    const chat = context().chat || [];
    const headMessageIndex = chat.length - 1;
    const start = Math.max(0, chat.length - 64);
    const selectedHistory = chat.slice(start).map((message, offset) => (
        `${start + offset}:${messageFingerprint(message)}`
    )).join('|');
    const watermark = value => Number.isInteger(Number(value)) ? Number(value) : -1;
    return {
        id: 'main',
        headMessageIndex,
        sourceMessageIndex: Math.max(
            watermark(runtime.store?.lastProcessedIndex),
            watermark(runtime.store?.progression?.lastProcessedIndex),
        ),
        headFingerprint: [
            hashString(`forward|${chat.length}|${selectedHistory}`),
            hashString(`reverse|${[...selectedHistory].reverse().join('')}`),
            hashString(`boundary|${start}|${chat.length}|${selectedHistory.length}`),
        ].join(''),
        metadata: { historyWindowStart: start, historyLength: chat.length },
    };
}

function contextStateKey(branch = narrativeBranchDescriptor()) {
    const settings = getSettings();
    return [
        runtime.storageWorldId,
        runtime.storageRevision,
        branch.id,
        branch.headFingerprint,
        settings.contextProfileId,
        contextConfigurationFingerprint(settings),
    ].join(':');
}

function narrativeScene(scene) {
    if (!scene || typeof scene !== 'object') return {};
    const cleanRecord = item => item && typeof item === 'object' ? {
        id: cleanString(item.id, 512) || null,
        name: cleanString(item.name, 512) || null,
        reason: cleanString(item.reason, 512) || null,
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
    } : null;
    return {
        currentIndex: Number.isInteger(scene.currentIndex) ? scene.currentIndex : -1,
        latestMessageIndex: Number.isInteger(scene.latestMessageIndex) ? scene.latestMessageIndex : -1,
        latestUserIndex: Number.isInteger(scene.latestUserIndex) ? scene.latestUserIndex : -1,
        latestUserName: cleanString(scene.latestUserName, 160),
        location: cleanRecord(scene.location),
        participants: (scene.participants || []).map(cleanRecord).filter(Boolean).slice(0, 32),
        addressed: (scene.addressed || []).map(cleanRecord).filter(Boolean).slice(0, 32),
        objects: (scene.objects || []).map(cleanRecord).filter(Boolean).slice(0, 32),
    };
}

function contextObservation(branch) {
    const stats = runtime.store?.lastRunStats;
    if (!stats || typeof stats !== 'object') return null;
    const startMessageIndex = Number.isInteger(stats.startIndex) ? stats.startIndex : -1;
    const endMessageIndex = Number.isInteger(stats.endIndex) ? stats.endIndex : -1;
    if (startMessageIndex < 0 && endMessageIndex < 0) return null;
    return {
        startMessageIndex,
        endMessageIndex,
        idempotencyKey: `${startMessageIndex}:${endMessageIndex}:${branch.headFingerprint}`,
        stats,
    };
}

function currentContextRequest(compilation = runtime.lastCompilation) {
    const settings = getSettings();
    const ctx = context();
    const branch = narrativeBranchDescriptor();
    const latest = ctx.chat?.at(-1);
    return {
        key: contextStateKey(branch),
        branch,
        scene: narrativeScene(compilation?.scene),
        input: {
            expectedRevision: runtime.storageRevision,
            profileId: settings.contextProfileId,
            branchId: branch.id,
            headFingerprint: branch.headFingerprint,
            currentMessageIndex: branch.headMessageIndex,
            scene: narrativeScene(compilation?.scene),
            recentText: recentStoryText(Math.max(settings.loreRecencyMessages, settings.brainRecencyMessages)),
            turn: latest ? {
                status: latest.is_user && !latest.is_system ? 'uncommitted_input' : 'committed',
                speakerName: cleanString(latest.name, 160),
                messageIndex: branch.headMessageIndex,
                fingerprint: messageFingerprint(latest),
                text: cleanString(latest.mes, 12_000),
            } : {},
            audience: { role: 'narrator' },
            overrides: contextProfileOverrides(settings),
        },
    };
}

async function prepareServerContext({ force = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled || !runtime.storageReady || !runtime.storageWorldId || !runtime.store || runtime.store.needsRebuild) return null;
    const request = currentContextRequest();
    if (!force && runtime.preparedContext?.key === request.key) return runtime.preparedContext;
    if (!force && runtime.contextPreparation?.key === request.key) return runtime.contextPreparation.promise;
    const controller = new AbortController();
    const timeoutMs = Math.min(5_000, Math.max(250, Number(settings.serverContextTimeoutMs) || 1_200));
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestedWorldId = runtime.storageWorldId;
    const promise = (async () => {
        try {
            const result = await activeStorageClient().buildContext(requestedWorldId, request.input, { signal: controller.signal });
            if (requestedWorldId !== runtime.storageWorldId || request.key !== contextStateKey()) return null;
            runtime.preparedContext = normalizePreparedContext(result, request.key);
            runtime.contextPreparationError = '';
            updateInjection();
            return runtime.preparedContext;
        } catch (error) {
            if (requestedWorldId === runtime.storageWorldId) {
                runtime.contextPreparationError = cleanString(error?.message || String(error), 1_000);
                log('Prepared server context unavailable; local compiler remains active:', runtime.contextPreparationError);
            }
            return null;
        } finally {
            clearTimeout(timer);
            if (runtime.contextPreparation?.promise === promise) runtime.contextPreparation = null;
        }
    })();
    runtime.contextPreparation = { key: request.key, promise, controller };
    return promise;
}


/**
 * Cast cards: a small strip at the top-left of the screen showing the player
 * and the current scene's NPCs with an SVG icon each. Every NPC card carries
 * an eye button that renders that NPC's private InnerLore mind into the chat
 * area as an ephemeral, styled bubble - a player-side view only; it is never
 * saved to the chat and never enters the model's context.
 */
/** Dock styles for the HUD strip, injected from the (cache-busted) module so
 *  a stale stylesheet can never unstyle the bar. Night-theme palette. */
const DOCK_STYLE_ID = 'il_dock_styles';
function ensureDockStyles() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    if (document.getElementById(DOCK_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = DOCK_STYLE_ID;
    style.textContent = `
#il_cast_bar{position:fixed;z-index:1000}
#il_cast_bar.il-dock{--il-gold:#ecd9ac;--il-line:rgba(255,255,255,.09);top:var(--il-dock-top,calc(env(safe-area-inset-top,0px) + 44px));left:0;right:0;width:auto;max-width:none;display:block;padding:0;background:linear-gradient(180deg,rgba(15,18,24,.97),rgba(10,12,17,.96));border-bottom:1px solid rgba(226,201,154,.16);box-shadow:0 8px 20px rgba(0,0,0,.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#d6dbe4;font-size:calc(var(--mainFontSize,15px) * .93);line-height:1.3;pointer-events:auto}
#il_cast_bar.il-dock *{box-sizing:border-box}
body.il-dock-active #chat{padding-top:var(--il-dock-clearance,96px)}
#il_menu_bar{--il-gold:#ecd9ac;flex:none;order:99;position:relative;z-index:30;display:flex;justify-content:center;gap:6px;padding:4px 10px calc(4px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,rgba(14,17,23,.97),rgba(9,11,15,.98));border-top:1px solid rgba(226,201,154,.16);color:#aab3c0;font-size:calc(var(--mainFontSize,15px) * .78);line-height:1.2}
#il_menu_bar *{box-sizing:border-box}
.il-menu-item{flex:0 1 104px;min-width:68px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 6px 5px;border:0;border-radius:12px;background:none;color:inherit;font:inherit;letter-spacing:.02em;cursor:pointer}
.il-menu-item svg{width:24px;height:24px;color:#e2c99a}
.il-menu-item:hover,.il-menu-item:focus-visible{background:rgba(226,201,154,.09);color:var(--il-gold);outline:none}
body.il-keyboard #il_menu_bar{display:none}
.il-hud{display:flex;align-items:center;gap:10px;max-width:1180px;margin:0 auto;padding:6px 12px;min-height:54px}
.il-hud-place{display:flex;align-items:center;gap:9px;flex:0 1 auto;min-width:0;max-width:min(34%,320px);padding:4px 8px 4px 4px;border:0;border-radius:12px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.il-hud-place:hover{background:rgba(255,255,255,.05)}
.il-hud-pin{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#e2c99a;background:radial-gradient(circle at 50% 35%,rgba(226,201,154,.28),rgba(226,201,154,.06));border:1px solid rgba(226,201,154,.38)}
.il-hud-pin svg{width:17px;height:17px}
.il-hud-place-text{display:flex;flex-direction:column;min-width:0}
.il-hud-place-name{font-weight:650;color:var(--il-gold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-hud-place-time{display:flex;align-items:center;gap:4px;font-size:.78em;color:#8f99a8;white-space:nowrap;overflow:hidden}
.il-hud-place-time svg{width:12px;height:12px;flex:none}
.il-hud-place-time span{overflow:hidden;text-overflow:ellipsis}
.il-hud-cast{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;padding:3px 2px 3px 12px;border-left:1px solid var(--il-line);scrollbar-width:none}
.il-hud-cast::-webkit-scrollbar{display:none}
.il-hud-avatar{flex:none;display:flex;flex-direction:column;align-items:center;gap:3px;width:50px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
.il-hud-face{position:relative;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:.8em;font-weight:700;letter-spacing:.02em;color:#0d1016;background:hsl(var(--hue,210) 34% 64%);box-shadow:0 0 0 2px #0e1117,0 0 0 3px hsl(var(--hue,210) 25% 38%);transition:transform .12s,box-shadow .12s}
.il-hud-avatar:hover .il-hud-face{transform:translateY(-1px);box-shadow:0 0 0 2px #0e1117,0 0 0 3px #e2c99a}
.il-hud-avatar.is-user .il-hud-face{background:#8fb7e8;box-shadow:0 0 0 2px #0e1117,0 0 0 3.5px #cfe3f7}
.il-hud-avatar.is-recent .il-hud-face{opacity:.55;filter:saturate(.6)}
.il-hud-avatar.is-more .il-hud-face{background:rgba(255,255,255,.08);color:#cfd6e0;box-shadow:0 0 0 1px var(--il-line)}
.il-hud-name{max-width:50px;font-size:.7em;color:#aab3c0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-hud-face.has-portrait,.il-cast-portrait.has-portrait{background:#1a1f29;overflow:hidden}
.il-hud-face img,.il-cast-portrait img,.il-entity-photo img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 22%;border-radius:inherit}
.il-hud.has-cards .il-hud-place{flex:1 1 auto;max-width:none}
.il-hud.has-cards .il-hud-cast{flex:none;padding-left:10px}
.il-cast-row{display:flex;gap:8px;max-width:1180px;margin:0 auto;padding:0 12px 8px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.il-cast-row::-webkit-scrollbar{display:none}
.il-cast-card{flex:0 0 auto;display:flex;align-items:center;gap:9px;width:176px;padding:5px 10px 5px 5px;border:1px solid var(--il-line);border-radius:14px;background:rgba(255,255,255,.035);color:inherit;font:inherit;text-align:left;cursor:pointer}
.il-cast-card:hover,.il-cast-card:focus-visible{border-color:rgba(226,201,154,.45);outline:none}
.il-cast-card.is-recent{opacity:.62}
.il-cast-portrait{position:relative;flex:none;width:46px;height:46px;border-radius:11px;display:grid;place-items:center;font-size:.82em;font-weight:700;color:#0d1016;background:hsl(var(--hue,210) 34% 64%)}
.il-cast-card.is-drawing .il-cast-portrait::after{content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 2px rgba(226,201,154,.8);animation:il-drawing 1.4s ease-in-out infinite}
@keyframes il-drawing{50%{opacity:.2}}
.il-cast-text{min-width:0;display:flex;flex-direction:column;gap:1px}
.il-cast-text b{font-size:.86em;font-weight:650;line-height:1.2;color:#e8ebf0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.il-cast-text small{font-size:.72em;color:#8f99a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-hud-actions{flex:none;display:flex;gap:6px}
.il-hud-btn{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;padding:0;border:1px solid var(--il-line);background:rgba(255,255,255,.04);color:#cfd6e0;cursor:pointer}
.il-hud-btn:hover{border-color:rgba(226,201,154,.45);color:var(--il-gold)}
.il-hud-btn svg{width:18px;height:18px;transition:transform .15s}
.il-hud-btn[aria-expanded="true"]{background:rgba(226,201,154,.14);color:var(--il-gold)}
.il-hud-btn[aria-expanded="true"] svg{transform:rotate(180deg)}
.il-hud-drawer{position:absolute;left:0;right:0;top:100%;background:#0b0d12;border-bottom:1px solid rgba(226,201,154,.16);box-shadow:0 14px 28px rgba(0,0,0,.5);max-height:min(62vh,460px);overflow-y:auto}
.il-hud-drawer-inner{max-width:1180px;margin:0 auto;padding:10px 14px 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.il-hud-section h4{margin:0 0 7px;font-size:.68em;letter-spacing:.16em;text-transform:uppercase;color:#7d8796;font-weight:600}
.il-hud-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.il-hud-row{display:flex;align-items:center;gap:10px;width:100%;padding:7px 9px;border-radius:12px;border:1px solid var(--il-line);background:rgba(255,255,255,.03);color:inherit;font:inherit;text-align:left;cursor:pointer}
.il-hud-row:hover{border-color:rgba(226,201,154,.4)}
.il-hud-row.is-recent{opacity:.7}
.il-hud-row .il-hud-face{width:30px;height:30px;font-size:.72em;flex:none}
.il-hud-row-text{min-width:0;display:flex;flex-direction:column}
.il-hud-row-text b{font-weight:600;color:#e4e8ef}
.il-hud-row-text small{color:#8f99a8;font-size:.8em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.il-hud-place-dot{flex:none;width:30px;display:grid;place-items:center}
.il-hud-place-dot::before{content:'';width:10px;height:10px;border-radius:50%;background:#e2c99a;box-shadow:0 0 0 3px rgba(226,201,154,.18)}
.il-hud-note{margin:6px 2px 0;font-size:.8em;color:#7d8796;font-style:italic}
.il-hud-empty{margin:0;font-size:.85em;color:#6d7684;font-style:italic}
.il-hud-links{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}
.il-hud-link{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:12px;border:1px solid var(--il-line);background:rgba(255,255,255,.04);color:#cfd6e0;font:inherit;font-size:.88em;cursor:pointer}
.il-hud-link:hover{border-color:rgba(226,201,154,.45);color:var(--il-gold)}
.il-hud-link svg{width:15px;height:15px}
@media (max-width:640px){
.il-hud{gap:8px;padding:5px 8px;min-height:50px}
.il-hud-place{max-width:44%;gap:7px;padding-right:4px}
.il-hud-pin{width:30px;height:30px}
.il-hud-cast{gap:6px;padding-left:8px}
.il-hud-avatar{width:auto}
.il-hud-name{display:none}
.il-hud-face{width:32px;height:32px}
.il-hud-btn{width:38px;height:38px}
.il-cast-row{gap:6px;padding:0 8px 6px}
.il-cast-card{width:164px;gap:7px}
.il-cast-portrait{width:42px;height:42px}
}
@media (max-width:480px){
.il-hud-place{max-width:36%}
.il-hud-actions{gap:4px}
.il-hud-btn{width:34px;height:34px}
.il-hud-btn svg{width:17px;height:17px}
}
#il_entity_card{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-width:none!important;z-index:42000;background:#0c0f15;color:#c9cfd9}
.il-entity-card-inner{display:flex;flex-direction:column;width:100%;height:100%}
.il-entity-head{display:flex;align-items:center;gap:12px;padding:calc(env(safe-area-inset-top,0px) + 14px) 16px 14px;border-bottom:1px solid #2c313c;background:linear-gradient(180deg, rgba(38,44,58,.95), rgba(20,24,33,.98))}
.il-entity-heading{flex:1;display:flex;flex-direction:column;min-width:0}
.il-entity-kicker{font-size:.62em;letter-spacing:.22em;text-transform:uppercase;color:#6d7684}
.il-entity-title{font-weight:700;font-size:1.15em;color:#e2c99a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-entity-photo{display:flex;width:52px;height:52px;align-items:center;justify-content:center;border:1px solid #4a5468;border-radius:12px;color:#9aa8be;background:radial-gradient(circle at 50% 30%, rgba(90,105,135,.4), rgba(28,32,42,.9))}
.il-entity-photo svg{width:30px;height:30px}
.il-entity-photo.has-portrait{overflow:hidden;border-color:rgba(226,201,154,.45)}
.il-entity-portrait-slot{display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:14px}
.il-entity-portrait{position:relative;width:min(100%,300px);aspect-ratio:1;margin:0;border:1px solid rgba(226,201,154,.3);border-radius:16px;overflow:hidden;background:radial-gradient(circle at 50% 35%,rgba(90,105,135,.35),rgba(20,24,33,.95));box-shadow:0 10px 30px rgba(0,0,0,.45)}
.il-entity-portrait img{display:block;width:100%;height:100%;object-fit:cover}
.il-entity-portrait.is-empty{display:grid;place-items:center;padding:16px;text-align:center;color:#8f99a8;font-size:.85em;font-style:italic}
.il-entity-portrait figcaption{position:absolute;left:0;right:0;bottom:0;padding:8px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.75));color:#ecd9ac;font-size:.8em;text-align:center}
.il-entity-redraw{padding:6px 12px;border:1px solid #4a5468;border-radius:10px;background:rgba(28,32,42,.8);color:#c3cad6;font:inherit;font-size:.82em;cursor:pointer}
.il-entity-redraw:hover{border-color:rgba(226,201,154,.55);color:#ecd9ac}
.il-entity-close{display:flex;width:40px;height:40px;align-items:center;justify-content:center;border:1px solid #4a5468;border-radius:10px;background:rgba(28,32,42,.8);color:#c3cad6;cursor:pointer}
.il-entity-close svg{width:18px;height:18px}
.il-entity-close:hover{border-color:#c96a6a;color:#e8a0a0}
.il-entity-body{flex:1;overflow-y:auto;padding:16px 18px calc(env(safe-area-inset-bottom,0px) + 24px)}
.il-entity-details{background:rgba(26,30,40,.55);border:1px solid #2c313c;border-radius:12px;padding:12px 14px;margin-bottom:14px}
.il-entity-summary{font-size:.92em}
.il-entity-state{font-size:.85em;color:#9fd6a8}
.il-entity-facts{margin:8px 0;padding-left:18px;font-size:.85em;color:#a8b0bc}
.il-entity-mind{background:linear-gradient(180deg, rgba(40,34,64,.35), rgba(24,22,36,.5));border:1px solid #3d3560;border-radius:12px;padding:12px 14px}
.il-entity-mind h4{margin:0 0 8px;color:#9c8eee;font-size:.95em}
.il-entity-mind h4 small{color:#6d7684;font-weight:400}
.il-entity-mind p{margin:4px 0;font-size:.85em}
.il-entity-mind hr{border:none;border-top:1px solid #2c313c;margin:8px 0}
.is-dormant{color:#6d7684;font-style:italic}
`;
    document.head.appendChild(style);
}

const HUD_SVG = {
    live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M9 21h6"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>',
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
    backpack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4.6V3.5a2 2 0 0 1 4 0v1.1"/><path d="M6 10.5A5.9 5.9 0 0 1 12 4.6a5.9 5.9 0 0 1 6 5.9V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M6 12.5H4.5a1 1 0 0 0-1 1V18M18 12.5h1.5a1 1 0 0 1 1 1V18"/><rect x="8.5" y="14" width="7" height="4.5" rx="1.2"/><path d="M8.5 11h7"/></svg>',
    trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/></svg>',
};
// Avatars shown in the bar itself; the rest are one tap away in the drawer.
const HUD_MAX_AVATARS = 6;

const CAST_SVG = {
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/><path d="M17 3l4 4M21 3l-4 4"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/></svg>',
};

function castBarElement() {
    let bar = document.getElementById('il_cast_bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'il_cast_bar';
        bar.className = 'displayNone';
        document.body.appendChild(bar);
    }
    return bar;
}

function mindBubbleText(brain) {
    const lines = [];
    const mind = brain?.currentMind;
    if (mind) {
        if (mind.perception) lines.push(`Perception: ${mind.perception}`);
        if (mind.interpretation) lines.push(`Interpretation: ${mind.interpretation}`);
        const emotions = (mind.emotions || []).map(e => `${e.name}${e.intensity ? ` (${e.intensity})` : ''}`);
        if (emotions.length) lines.push(`Emotions: ${emotions.join(', ')}`);
        if (mind.attention) lines.push(`Attention: ${mind.attention}`);
        if (mind.expectation) lines.push(`Expectation: ${mind.expectation}`);
        if (mind.immediateGoal) lines.push(`Immediate goal: ${mind.immediateGoal}`);
        for (const thought of (mind.innerThoughts || []).slice(0, 3)) lines.push(`*${thought}*`);
    } else {
        lines.push('(no fresh current mind - the curator has not observed this NPC since the latest scene)');
    }
    const facets = Object.values(brain?.persistentSelf?.facets || {}).slice(0, 6);
    const voice = Object.values(brain?.persistentSelf?.voice || {}).slice(0, 2);
    if (facets.length || voice.length) {
        lines.push('');
        lines.push('Persistent self:');
        for (const facet of facets) lines.push(`- [${facet.kind}] ${facet.statement}`);
        for (const anchor of voice) lines.push(`- (voice: ${anchor.kind}) ${anchor.statement}`);
    }
    return lines.join('\n');
}

function renderMindInChat(name) {
    const store = getChatStore();
    const brain = store?.brains?.[canonicalNameKey(name)];
    const chat = document.getElementById('chat');
    if (!chat) return;
    const bubble = document.createElement('div');
    bubble.className = 'mes il-mind-bubble';
    const title = document.createElement('div');
    title.className = 'il-mind-title';
    title.textContent = `InnerLore - private mind of ${name} (player view only, never sent to the model)`;
    const body = document.createElement('div');
    body.className = 'il-mind-body';
    body.textContent = brain ? mindBubbleText(brain) : `(no InnerLore mind is tracked for ${name} yet)`;
    bubble.append(title, body);
    chat.appendChild(bubble);
    bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/**
 * NPC portraits: kept in the chat's metadata ({ name key: { name, path,
 * prompt, seed, at } }) so they travel with the chat and its branches. The
 * files live in SillyTavern's user images, under InnerLore/.
 */
function portraitsOn() {
    const settings = getSettings();
    return settings.enabled && settings.portraitsEnabled !== false;
}

function portraitRecords() {
    const records = context().chatMetadata?.[PORTRAIT_METADATA_KEY];
    return records && typeof records === 'object' ? records : {};
}

function portraitOf(name) {
    const key = canonicalNameKey(name);
    const entity = Object.values(getChatStore()?.entities || {})
        .find(candidate => candidate?.type === 'character'
            && (canonicalNameKey(candidate.name) === key || (candidate.aliases || []).some(alias => canonicalNameKey(alias) === key)));
    return findPortrait(portraitRecords(), name, [entity?.name, ...(entity?.aliases || [])].filter(Boolean));
}

function portraitQueue() {
    runtime.portraitQueue ||= createPortraitQueue({ run: drawPortrait, onChange: refreshPortraitViews });
    return runtime.portraitQueue;
}

/**
 * Queue a portrait for each person named who has none and whose looks the
 * story has described. Shrinking and showing pictures needs a browser.
 */
function wantPortraits(names, { force = false } = {}) {
    if (!portraitsOn() || typeof globalThis.Image !== 'function') return;
    const chatId = currentChatId();
    const store = getChatStore();
    if (!chatId || !store) return;
    const queue = portraitQueue();
    queue.keepChat(chatId);
    queue.want(names
        .filter(name => force || (!portraitOf(name) && !queue.isDrawing(canonicalNameKey(name))))
        .filter(name => portraitSource(store, name))
        .map(name => ({ key: canonicalNameKey(name), name, chatId, force })));
}

/** The fork's image service, when the extension runs inside the shell. */
function shellImageService() {
    const service = typeof window !== 'undefined' ? window.InnerLoreShell?.getService?.('image') : null;
    return service && typeof service === 'object' ? service : null;
}

function portraitServer() {
    const service = shellImageService();
    if (service) {
        if (service.provider === 'openai-images') {
            return { url: cleanString(service.url, 300), auth: '', provider: 'openai-images', secretId: cleanString(service.secretId, 80), model: cleanString(service.model, 120) };
        }
        return { url: cleanString(service.url, 300) || PORTRAIT_DEFAULTS.serverUrl, auth: cleanString(service.auth, 200) };
    }
    const sd = context().extensionSettings?.sd || {};
    return {
        url: cleanString(getSettings().portraitServerUrl, 300)
            || (sd.source === 'auto' ? cleanString(sd.auto_url, 300) : '')
            || PORTRAIT_DEFAULTS.serverUrl,
        auth: sd.auto_auth || '',
    };
}

// The server's picture (a 1024px PNG of about 1.5 MB from Local Dream) is
// kept as a 384px WebP of a few dozen KB, cropped square from the top.
async function shrinkPortrait(base64) {
    try {
        const picture = new Image();
        picture.src = `data:image/png;base64,${base64}`;
        await picture.decode();
        const side = Math.min(picture.naturalWidth, picture.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = 384;
        canvas.height = 384;
        canvas.getContext('2d').drawImage(picture, (picture.naturalWidth - side) / 2, 0, side, side, 0, 0, 384, 384);
        for (const [type, format] of [['image/webp', 'webp'], ['image/jpeg', 'jpg']]) {
            const url = canvas.toDataURL(type, 0.86);
            if (url.startsWith(`data:${type}`)) return { data: url.slice(url.indexOf(',') + 1), format };
        }
    } catch (error) {
        console.warn('[InnerLore] Could not shrink a portrait; keeping it full size:', error);
    }
    return { data: base64, format: 'png' };
}

async function drawPortrait(job) {
    const settings = getSettings();
    const store = getChatStore();
    const source = store && portraitSource(store, job.name, {
        placeName: resolveSceneLocation(store, runtime.lastCompilation?.scene).name || '',
    });
    if (!source) throw new Error('the story has not described them yet');
    const tags = await requestPortraitTags(settings, source);
    const payload = portraitPayload(composePortraitPrompt(tags, settings.portraitStyle), {
        negative: settings.portraitNegative,
        steps: settings.portraitSteps,
        cfg: settings.portraitCfg,
    });
    // Local Dream takes about 90 s a picture, and waits while it is not running.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000);
    let image;
    try {
        const server = portraitServer();
        if (server.provider === 'openai-images') {
            // An OpenAI-compatible images API, through the storage plugin (which holds the key).
            const response = await fetch(`${settings.storageApiRoot || '/api/plugins/innerlore-storage/v1'}/images/generate`, {
                method: 'POST',
                headers: { ...context().getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ service: server, prompt: payload.prompt, negative_prompt: payload.negative_prompt, width: payload.width, height: payload.height }),
                signal: controller.signal,
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body?.error?.message || `the image service failed (HTTP ${response.status})`);
            image = body?.data?.images?.[0];
        } else {
            const response = await fetch('/api/sd/generate', {
                method: 'POST',
                headers: context().getRequestHeaders(),
                body: JSON.stringify({ ...payload, url: server.url, auth: server.auth }),
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`the image server failed (HTTP ${response.status})`);
            image = (await response.json())?.images?.[0];
        }
    } catch (error) {
        const message = controller.signal.aborted ? 'the image server did not answer within 5 minutes' : error?.message || String(error);
        throw Object.assign(new Error(message), { serverDown: true });
    } finally {
        clearTimeout(timer);
    }
    if (!image) throw new Error('the image server sent no picture');
    if (currentChatId() !== job.chatId) return;
    const picture = await shrinkPortrait(image);
    const upload = await fetch('/api/images/upload', {
        method: 'POST',
        headers: context().getRequestHeaders(),
        body: JSON.stringify({ image: picture.data, format: picture.format, ch_name: PORTRAIT_FOLDER, filename: `${portraitFileStem(job.chatId, job.key)}-${payload.seed}` }),
    });
    if (!upload.ok) throw new Error(`the portrait could not be saved (HTTP ${upload.status})`);
    const { path } = await upload.json();
    const ctx = context();
    if (!path || currentChatId() !== job.chatId || !ctx.chatMetadata) return;
    ctx.chatMetadata[PORTRAIT_METADATA_KEY] = {
        ...portraitRecords(),
        [job.key]: { name: job.name, path, prompt: payload.prompt, seed: payload.seed, at: Date.now() },
    };
    ctx.saveMetadataDebounced?.();
}

/** The portrait files on the server (names only); an empty list when the folder was never made. */
async function listPortraitFiles() {
    const headers = context().getRequestHeaders();
    const folders = await fetch('/api/images/folders', { method: 'POST', headers, body: '{}' });
    if (!folders.ok) throw new Error(`image folders could not be listed: HTTP ${folders.status}`);
    if (!(await folders.json()).includes(PORTRAIT_FOLDER)) return [];
    const response = await fetch('/api/images/list', {
        method: 'POST',
        headers,
        body: JSON.stringify({ folder: PORTRAIT_FOLDER }),
    });
    if (!response.ok) throw new Error(`portrait files could not be listed: HTTP ${response.status}`);
    const files = await response.json();
    return Array.isArray(files) ? files.map(portraitFileName).filter(Boolean) : [];
}

/** Delete the named portrait files; a file already gone counts as deleted. */
async function deletePortraitFiles(files) {
    const deleted = [];
    const failed = [];
    for (const file of files) {
        try {
            const response = await fetch('/api/images/delete', {
                method: 'POST',
                headers: context().getRequestHeaders(),
                body: JSON.stringify({ path: `${PORTRAIT_FOLDER_PATH}/${file}` }),
            });
            if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
            deleted.push(file);
        } catch (error) {
            failed.push(file);
            console.warn(`${LOG_PREFIX} Could not delete the portrait file ${file}:`, error);
        }
    }
    return { candidates: [...files], deleted, failed };
}

/** Delete every portrait file a chat drew. Files from before the hash naming are left to the startup sweep. */
async function deleteChatPortraits(chatId) {
    return deletePortraitFiles(chatPortraitFiles(chatId, await listPortraitFiles()));
}

/** Copy a portrait file into one named for this chat; '' when the original is gone. */
async function copyPortraitFile(path, chatId, key, seed) {
    const original = await fetch(path, { cache: 'no-store' });
    if (original.status === 404) return '';
    if (!original.ok) throw new Error(`HTTP ${original.status} reading ${path}`);
    const blob = await original.blob();
    const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
        reader.onerror = () => reject(reader.error || new Error('the portrait could not be read'));
        reader.readAsDataURL(blob);
    });
    const format = portraitFileName(path).split('.').pop().toLowerCase() || 'webp';
    const upload = await fetch('/api/images/upload', {
        method: 'POST',
        headers: context().getRequestHeaders(),
        body: JSON.stringify({ image: data, format, ch_name: PORTRAIT_FOLDER, filename: `${portraitFileStem(chatId, key)}-${seed || Date.now()}` }),
    });
    if (!upload.ok) throw new Error(`the portrait copy could not be saved (HTTP ${upload.status})`);
    return (await upload.json())?.path || '';
}

/**
 * A chat shows the portraits in its metadata but owns only the files named
 * for it. Records inherited from the chat this one was branched, renamed or
 * started from (SillyTavern copies the metadata), or drawn before files were
 * named for their chat, are copied into this chat's own files, so deleting
 * either chat never takes the other's faces. A record whose file is gone is
 * dropped, and the person is drawn again. One adoption runs per chat at a
 * time; the promise lets a rename wait for it.
 */
function adoptPortraits() {
    const chatId = currentChatId();
    if (!chatId) return Promise.resolve();
    if (runtime.portraitAdoption?.chatId === chatId) return runtime.portraitAdoption.promise;
    const promise = (async () => {
        const ctx = context();
        for (const [key, record] of foreignPortraitRecords(portraitRecords(), chatId)) {
            if (currentChatId() !== chatId) return;
            const copy = await copyPortraitFile(record.path, chatId, key, record.seed);
            if (currentChatId() !== chatId || !ctx.chatMetadata) return;
            const records = { ...portraitRecords() };
            if (copy) records[key] = { ...record, path: copy };
            else delete records[key];
            ctx.chatMetadata[PORTRAIT_METADATA_KEY] = records;
            ctx.saveMetadataDebounced?.();
            // The chat's own file under the old naming has no other owner now.
            if (copy && isLegacyPortraitFileOf(chatId, record.path)) await deletePortraitFiles([portraitFileName(record.path)]);
            refreshPortraitViews();
        }
    })().catch(error => {
        console.warn(`${LOG_PREFIX} Could not adopt inherited portraits:`, error);
    }).finally(() => {
        if (runtime.portraitAdoption?.promise === promise) runtime.portraitAdoption = null;
    });
    runtime.portraitAdoption = { chatId, promise };
    return promise;
}

/** After a rename: the chat copies its faces under the new name, then the old name's files go. */
async function migratePortraits(oldChatId, newChatId) {
    const oldId = cleanString(oldChatId, 300);
    const newId = cleanString(newChatId, 300);
    if (!oldId || !newId || oldId === newId) return null;
    if (currentChatId() === newId) await adoptPortraits();
    return deleteChatPortraits(oldId);
}

// After the queue's own bookkeeping, never inside a cast refresh that queued it.
function refreshPortraitViews() {
    setTimeout(() => {
        updateCastCards();
        const popup = document.getElementById('il_entity_card');
        if (popup) fillEntityPortrait(popup);
    }, 0);
}

/** A person's face: their portrait, or their initials on their colour. */
function personFace(name, className) {
    const badge = personBadge(name);
    const face = document.createElement('span');
    face.className = className;
    face.style.setProperty('--hue', String(badge.hue));
    const portrait = portraitsOn() ? portraitOf(name) : null;
    if (!portrait) {
        face.textContent = badge.initials;
        return face;
    }
    const image = document.createElement('img');
    image.src = portrait.path;
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', () => {
        image.remove();
        face.classList.remove('has-portrait');
        face.textContent = badge.initials;
    }, { once: true });
    face.classList.add('has-portrait');
    face.append(image);
    return face;
}

// The portrait at the top of someone's page, with the button that draws a new one.
function fillEntityPortrait(popup) {
    const name = popup.dataset.name || '';
    const portrait = portraitsOn() ? portraitOf(name) : null;
    const photo = popup.querySelector('.il-entity-photo');
    if (photo) {
        photo.classList.toggle('has-portrait', Boolean(portrait));
        photo.innerHTML = portrait ? `<img src="${escapeHtml(portrait.path)}" alt="">` : CAST_SVG.person;
    }
    const slot = popup.querySelector('.il-entity-portrait-slot');
    if (!slot) return;
    slot.classList.toggle('displayNone', !portraitsOn());
    if (!portraitsOn()) return;
    const drawing = runtime.portraitQueue?.isDrawing(canonicalNameKey(name)) || false;
    const described = Boolean(getChatStore() && portraitSource(getChatStore(), name));
    if (portrait) {
        slot.innerHTML = `<figure class="il-entity-portrait"><img src="${escapeHtml(portrait.path)}" alt="Portrait of ${escapeHtml(name)}">${drawing ? '<figcaption>Drawing a new portrait…</figcaption>' : ''}</figure>`;
    } else {
        const note = drawing ? 'Drawing a portrait…' : described ? 'No portrait yet' : 'A portrait is drawn once the story describes them';
        slot.innerHTML = `<figure class="il-entity-portrait is-empty"><span>${note}</span></figure>`;
    }
    if (drawing || !described) return;
    const redraw = document.createElement('button');
    redraw.type = 'button';
    redraw.className = 'il-entity-redraw';
    redraw.textContent = portrait ? 'Draw a new portrait' : 'Draw a portrait';
    redraw.addEventListener('click', () => wantPortraits([name], { force: true }));
    slot.append(redraw);
}

function showEntityCard(name, focus = 'details') {
    let popup = document.getElementById('il_entity_card');
    if (popup) popup.remove();
    popup = document.createElement('div');
    popup.id = 'il_entity_card';
    const store = getChatStore();
    const entity = Object.values(store?.entities || {})
        .find(candidate => candidate?.type === 'character' && canonicalNameKey(candidate.name) === canonicalNameKey(name));
    const brain = store?.brains?.[canonicalNameKey(name)];
    const standing = getSettings().gameEnabled !== false
        ? normalizeGameState(store?.game).standings?.[canonicalNameKey(name)]
        : null;
    const standingHtml = standing
        ? `<p class="il-entity-state"><b>Regards you:</b> ${standingTier(standing.score)} (${standing.score > 0 ? '+' : ''}${standing.score})${standing.notes?.at(-1)?.reason ? ` - ${escapeHtml(standing.notes.at(-1).reason)}` : ''}</p>`
        : '';
    const facts = (entity?.facts || []).slice(0, 6)
        .map(fact => `<li>${String(typeof fact === 'string' ? fact : fact?.statement || '').replace(/</g, '&lt;')}</li>`).join('');
    const mindHtml = brain
        ? mindBubbleText(brain).split('\n').map(line => line ? `<p>${line.replace(/</g, '&lt;')}</p>` : '<hr/>').join('')
        : '<p class="is-dormant">(no InnerLore mind is tracked for this name yet)</p>';
    popup.dataset.name = name;
    popup.innerHTML = `
        <div class="il-entity-card-inner">
            <div class="il-entity-head">
                <span class="il-entity-photo">${CAST_SVG.person}</span>
                <div class="il-entity-heading">
                    <span class="il-entity-kicker">character</span>
                    <span class="il-entity-title">${String(name).replace(/</g, '&lt;')}</span>
                </div>
                <button type="button" class="il-entity-close" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
            </div>
            <div class="il-entity-body">
                <section class="il-entity-portrait-slot"></section>
                <section class="il-entity-details">
                    ${entity?.summary ? `<p class="il-entity-summary">${String(entity.summary).replace(/</g, '&lt;')}</p>` : ''}
                    ${entity?.currentState ? `<p class="il-entity-state"><b>Now:</b> ${String(entity.currentState).replace(/</g, '&lt;')}</p>` : ''}
                    ${standingHtml}
                    ${facts ? `<ul class="il-entity-facts">${facts}</ul>` : ''}
                    ${!entity ? '<p class="is-dormant">(no entity record yet - it appears once the curator observes this NPC)</p>' : ''}
                </section>
                <section class="il-entity-mind">
                    <h4>Private mind <small>(player view only, never sent to the model)</small></h4>
                    ${mindHtml}
                </section>
            </div>
        </div>`;
    document.body.appendChild(popup);
    fillEntityPortrait(popup);
    fillEntityVoice(popup);
    popup.querySelector('.il-entity-close').addEventListener('click', () => popup.remove());
    popup.addEventListener('click', event => {
        if (event.target === popup) popup.remove();
    });
    const target = focus === 'mind' ? popup.querySelector('.il-entity-mind') : popup.querySelector('.il-entity-details');
    target?.scrollIntoView({ block: 'nearest' });
}

/**
 * Resolve the scene's location for display: known entities pass through; a
 * generic prose phrase ("the city", "a side street") that matched no entity
 * falls back to the last known canonical location instead of replacing the
 * HUD with raw narration wording. Genuinely new named places (proper nouns)
 * are kept as-is - they are real discoveries.
 */
function resolveSceneLocationForDisplay(scene) {
    const location = scene?.location;
    if (!location?.name) return scene;
    if (location.id) {
        runtime.lastKnownSceneLocation = location.name;
        return scene;
    }
    const words = String(location.name).split(/\s+/).filter(Boolean);
    const hasProperNoun = words.some(word => /\p{Lu}/u.test(word) && !/^(?:The|A|An)$/u.test(word));
    if (hasProperNoun) return scene;
    if (runtime.lastKnownSceneLocation) {
        return { ...scene, location: { ...location, name: runtime.lastKnownSceneLocation, resolvedFromPhrase: location.name } };
    }
    return scene;
}

// The scene the HUD and map show: normally the context compiler's. While the
// store is quarantined for a history rebuild nothing is compiled, so derive it
// from the chat the same model-free way a landed reply does.
function displayScene(store) {
    const compiled = runtime.lastCompilation?.scene;
    const ctx = context();
    if (compiled || !store || !Array.isArray(ctx.chat) || !ctx.chat.length) return compiled || null;
    try {
        return resolveSceneLocationForDisplay(deriveSceneState(ctx.chat, store, {
            currentIndex: ctx.chat.length - 1,
            playerName: ctx.name1,
            lookbackMessages: getSettings().sceneLookbackMessages ?? 4,
        }));
    } catch (error) {
        console.error('[InnerLore] Could not derive the scene for the HUD:', error);
        return null;
    }
}

// A reply's choices block leaves the story text, and so the history every
// later prompt and background pass reads, and is kept on the message for the
// buttons under it.
function captureReplyChoices(messageIndex) {
    const ctx = context();
    const message = ctx.chat?.[messageIndex];
    if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') return false;
    const { text, choices } = extractReplyChoices(message.mes);
    if (text === message.mes) return false;
    message.mes = text;
    message.extra = { ...(message.extra || {}), [CHOICES_EXTRA_KEY]: choices };
    if (typeof message.extra.display_text === 'string') {
        message.extra.display_text = extractReplyChoices(message.extra.display_text).text;
    }
    // Like SillyTavern, leave a pristine greeting's swipes alone so their
    // macros still resolve when swiped.
    const swipeId = message.swipe_id;
    if (ctx.chat.length > 1 && Number.isInteger(swipeId) && typeof message.swipes?.[swipeId] === 'string') {
        message.swipes[swipeId] = text;
        const info = message.swipe_info?.[swipeId];
        if (info && typeof info === 'object') info.extra = { ...(info.extra || {}), [CHOICES_EXTRA_KEY]: choices };
    }
    try {
        ctx.updateMessageBlock?.(messageIndex, message);
    } catch (error) {
        console.error('[InnerLore] Could not re-render a reply without its choices block:', error);
    }
    return true;
}

const CHOICE_ICONS = Object.freeze({ go: 'fa-person-walking', talk: 'fa-comment', do: 'fa-hand', look: 'fa-eye' });

function fillMessageBox(text, { focus = true } = {}) {
    const box = document.getElementById('send_textarea');
    if (!box) return;
    const current = box.value.trim();
    // A tapped move replaces the previous tapped move; anything typed is kept.
    box.value = !current || current === runtime.lastFilledChoice ? text : `${box.value.trimEnd()}\n${text}`;
    runtime.lastFilledChoice = box.value === text ? text : '';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    // Spoken words never pull the keyboard up: no focus for voice input.
    if (!focus) return;
    box.focus();
    box.setSelectionRange?.(box.value.length, box.value.length);
}

/** Keep the on-screen keyboard down after a spoken turn: SillyTavern refocuses the box when it sends. */
function keepKeyboardDown() {
    const box = document.getElementById('send_textarea');
    if (!box) return;
    const drop = () => { if (document.activeElement === box) box.blur(); };
    drop();
    setTimeout(drop, 50);
    setTimeout(drop, 300);
    setTimeout(drop, 900);
}

// The next moves under the latest reply: the narrator's own choices, or moves
// from the camera frame when it gave none.
function renderPlayerChoices() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const settings = getSettings();
    const chat = context().chat || [];
    const index = chat.length - 1;
    const message = chat[index];
    const show = settings.enabled && settings.guidedPlayEnabled !== false && !runtime.choicesHidden
        && message && !message.is_user && !message.is_system;
    let choices = show ? storedChoices(message) : [];
    if (show && !choices.length) choices = extractReplyChoices(message.mes).choices;
    if (show && !choices.length) choices = fallbackChoices(runtime.lastCompilation?.camera);
    const block = choices.length ? document.querySelector(`#chat .mes[mesid="${index}"] .mes_block`) : null;
    const signature = block ? `${index}|${JSON.stringify(choices)}` : '';
    const existing = document.querySelectorAll('.il-choices');
    if (signature && signature === runtime.choicesSignature && existing.length === 1 && block.contains(existing[0])) return;
    existing.forEach(node => node.remove());
    runtime.choicesSignature = signature;
    if (!block) return;
    const box = document.createElement('div');
    box.className = 'il-choices';
    for (const choice of choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'il-choice';
        button.dataset.kind = choice.kind;
        button.title = 'Put this move in the message box';
        const icon = document.createElement('i');
        icon.className = `fa-solid ${CHOICE_ICONS[choice.kind] || 'fa-arrow-right'}`;
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon, document.createTextNode(choice.text));
        button.addEventListener('click', () => fillMessageBox(choice.text));
        box.append(button);
    }
    block.append(box);
}

function updateCastCards() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    renderPlayerChoices();
    ensureDockStyles();
    renderMenuBar();
    const bar = castBarElement();
    bar.innerHTML = '';
    bar.classList.add('il-dock');
    document.body.classList.add('il-dock-active');
    const ctx = context();
    const userName = cleanString(ctx.name1, 100) || 'You';
    const userKey = canonicalNameKey(userName);
    // Scene participants are the primary source; NPCs whose private minds
    // were selected for the current compilation are equally "in the scene"
    // (the scene compiler can miss engaged characters whose entity records
    // lack fresh location anchors).
    const seen = new Set([userKey]);
    const participants = [];
    const pushParticipant = (name, recent = false) => {
        const key = canonicalNameKey(name || '');
        if (!name || !key || seen.has(key)) return;
        seen.add(key);
        participants.push({ name, recent });
    };
    const store = getChatStore();
    const scene = displayScene(store);
    for (const item of (scene?.participants || [])) pushParticipant(item?.name);
    for (const brain of (runtime.lastCompilation?.selectedBrains || [])) pushParticipant(brain?.name);
    // Recently-seen character entities: the narrator often refers to engaged
    // NPCs by descriptor ("the technician") rather than canonical name, so
    // mention matching alone can miss them - the curator's lastSeenMessage
    // watermark is the reliable presence signal.
    const chatLength = Array.isArray(context().chat) ? context().chat.length : 0;
    if (store) {
        const recent = [];
        for (const entity of Object.values(store.entities || {})) {
            if (entity?.type !== 'character' || entity.enabled === false) continue;
            const lastSeen = Number(entity.lastSeenMessage);
            if (Number.isInteger(lastSeen) && chatLength - lastSeen <= 6 && lastSeen >= 0) {
                recent.push({ name: entity.name, lastSeen });
            }
        }
        recent.sort((a, b) => b.lastSeen - a.lastSeen);
        for (const item of recent) pushParticipant(item.name, true);
    }
    participants.splice(8);
    if (!getSettings().enabled || !currentChatId()) {
        bar.classList.add('displayNone');
        return;
    }
    const where = resolveSceneLocation(store, scene).name || scene?.location?.name || 'Somewhere';
    const clock = store?.progression?.clock;
    const compactDuration = seconds => {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        if (total < 60) return `${total}s`;
        if (total < 3_600) return `${Math.round(total / 60)}m`;
        if (total < 86_400) return `${Math.round(total / 3_600)}h`;
        return `${Math.round(total / 86_400)}d`;
    };
    const rawLabel = clock?.currentTimeLabel || clock?.lastExactAnchor || '';
    const clockLabel = rawLabel || `T+${compactDuration(clock?.estimatedSeconds ?? 0)}`;

    // Where and when: tapping it opens the map around the player.
    const hud = document.createElement('div');
    hud.className = 'il-hud';
    const place = document.createElement('button');
    place.type = 'button';
    place.className = 'il-hud-place';
    place.title = `${where} - show the map around you`;
    place.innerHTML = `<span class="il-hud-pin">${HUD_SVG.pin}</span><span class="il-hud-place-text"><span class="il-hud-place-name"></span><span class="il-hud-place-time">${HUD_SVG.clock}<span></span></span></span>`;
    place.querySelector('.il-hud-place-name').textContent = where;
    place.querySelector('.il-hud-place-time span').textContent = clockLabel;
    place.querySelector('.il-hud-place-time').title = rawLabel
        ? `Story clock: ${rawLabel}`
        : `Story clock: ${compactDuration(clock?.estimatedSeconds ?? 0)} elapsed (estimate)`;
    place.addEventListener('click', () => openWorldMap('scene'));

    // Who: the player, then everyone in the scene, then the recently seen.
    // With cast cards on, the others are in the row of cards under the bar.
    const cardsShown = getSettings().castCardsEnabled !== false && participants.length > 0;
    const cast = document.createElement('div');
    cast.className = 'il-hud-cast';
    cast.setAttribute('role', 'list');
    cast.setAttribute('aria-label', 'People in the scene');
    const avatar = (name, { isUser = false, recent = false } = {}) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'il-hud-avatar' + (isUser ? ' is-user' : '') + (recent ? ' is-recent' : '');
        button.setAttribute('role', 'listitem');
        button.title = isUser ? `${name} (you)` : recent ? `${name} - seen recently` : `${name} - in the scene`;
        button.innerHTML = '<span class="il-hud-name"></span>';
        button.prepend(personFace(name, 'il-hud-face'));
        button.querySelector('.il-hud-name').textContent = isUser ? 'You' : name.split(/\s+/)[0];
        button.addEventListener('click', () => (isUser ? toggleHudDrawer() : showEntityCard(name, 'details')));
        return button;
    };
    cast.append(avatar(userName, { isUser: true }));
    const avatarCast = cardsShown ? [] : participants;
    for (const person of avatarCast.slice(0, HUD_MAX_AVATARS)) cast.append(avatar(person.name, person));
    const hiddenCast = avatarCast.length - HUD_MAX_AVATARS;
    if (hiddenCast > 0) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'il-hud-avatar is-more';
        more.title = `${hiddenCast} more - show everyone`;
        more.innerHTML = '<span class="il-hud-face"></span><span class="il-hud-name">More</span>';
        more.querySelector('.il-hud-face').textContent = `+${hiddenCast}`;
        more.addEventListener('click', () => toggleHudDrawer(true));
        cast.append(more);
    }

    // Actions: the world map, and the drawer with the details.
    const actions = document.createElement('div');
    actions.className = 'il-hud-actions';
    const mapButton = document.createElement('button');
    mapButton.type = 'button';
    mapButton.className = 'il-hud-btn';
    mapButton.title = 'World map';
    mapButton.setAttribute('aria-label', 'Open the world map');
    mapButton.innerHTML = HUD_SVG.map;
    mapButton.addEventListener('click', () => openWorldMap('world'));
    const drawerButton = document.createElement('button');
    drawerButton.type = 'button';
    drawerButton.className = 'il-hud-btn il-hud-toggle';
    drawerButton.title = 'Who is here and what is nearby';
    drawerButton.setAttribute('aria-label', 'Show who is here and what is nearby');
    drawerButton.setAttribute('aria-expanded', String(hudDrawerOpen()));
    drawerButton.innerHTML = HUD_SVG.chevron;
    drawerButton.addEventListener('click', () => toggleHudDrawer());
    actions.append(mapButton, drawerButton);
    hud.append(place, cast, actions);
    hud.classList.toggle('has-cards', cardsShown);
    bar.append(hud);
    if (cardsShown) bar.append(buildCastRow(participants, store));
    if (hudDrawerOpen()) bar.append(buildHudDrawer(store, scene, userName, participants));
    wantPortraits(participants.map(person => person.name));

    // An open full map follows the same refreshes as the HUD: a landed reply,
    // a committed curator pass, and every injection build.
    if (runtime.mapPanel && !document.getElementById('il_map_overlay')?.classList.contains('displayNone')) {
        runtime.mapPanel.refresh(store, scene, userName);
    }
    if (runtime.gamePanel?.isOpen()) runtime.gamePanel.refresh(store, scene, userName);
    if (runtime.tradePanel?.isOpen()) runtime.tradePanel.refresh(store, scene, userName);
    bar.classList.remove('displayNone');
    positionDock();
    watchDockPlacement();
}

/**
 * The people here as cards under the top bar: portrait, name, and what they
 * are and how they regard the player. A card opens the person's page.
 */
function buildCastRow(participants, store) {
    const row = document.createElement('div');
    row.className = 'il-cast-row';
    row.setAttribute('role', 'list');
    row.setAttribute('aria-label', 'People here');
    const game = getSettings().gameEnabled !== false && store ? normalizeGameState(store.game) : null;
    const roles = new Map();
    for (const stage of Object.values(game?.stages || {})) {
        for (const person of stage.people || []) if (person.role) roles.set(canonicalNameKey(person.name), person.role);
    }
    const entities = Object.values(store?.entities || {}).filter(entity => entity?.type === 'character');
    for (const person of participants) {
        const key = canonicalNameKey(person.name);
        const entity = entities.find(candidate => canonicalNameKey(candidate.name) === key);
        // The planner's role, or the first clause of the curator's summary.
        const role = roles.get(key) || cleanString(String(entity?.summary || '').split(/[,;.]/u)[0], 60);
        const standing = game?.standings?.[key];
        const detail = [standing ? standingTier(standing.score) : '', role].filter(Boolean).join(' · ')
            || (person.recent ? 'Seen recently' : 'Here');
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'il-cast-card' + (person.recent ? ' is-recent' : '')
            + (runtime.portraitQueue?.isDrawing(key) ? ' is-drawing' : '');
        card.setAttribute('role', 'listitem');
        card.title = `${person.name}${person.recent ? ' - seen recently' : ''}${runtime.portraitQueue?.isDrawing(key) ? ' - drawing a portrait' : ''}`;
        const text = document.createElement('span');
        text.className = 'il-cast-text';
        const name = document.createElement('b');
        name.textContent = person.name;
        const small = document.createElement('small');
        small.textContent = detail;
        text.append(name, small);
        card.append(personFace(person.name, 'il-cast-portrait'), text);
        card.addEventListener('click', () => showEntityCard(person.name, 'details'));
        row.append(card);
    }
    return row;
}

/**
 * The dock sits directly below SillyTavern's top bar, whose height depends on
 * the theme and screen (a phone theme can make it far taller than the
 * desktop's), and story text starts below the dock's real bottom edge (wraps
 * included), so neither the dock nor any message is covered.
 */
function positionDock() {
    const bar = document.getElementById('il_cast_bar');
    if (!bar || bar.classList.contains('displayNone')) return;
    const root = document.documentElement;
    const topBarBottom = Math.max(0, ...['#top-bar', '#top-settings-holder']
        .map(selector => document.querySelector(selector)?.getBoundingClientRect().bottom || 0));
    if (topBarBottom > 0) root.style.setProperty('--il-dock-top', `${Math.ceil(topBarBottom)}px`);
    const barBottom = bar.getBoundingClientRect().bottom;
    if (!Number.isFinite(barBottom) || barBottom <= 0) return;
    // The padding sits inside #chat, which itself starts below the top bar.
    const chatTop = document.getElementById('chat')?.getBoundingClientRect().top || 0;
    root.style.setProperty('--il-dock-clearance', `${Math.ceil(Math.max(0, barBottom - chatTop) + 10)}px`);
}

function hudDrawerOpen() {
    if (typeof runtime.hudDrawerOpen !== 'boolean') {
        try {
            runtime.hudDrawerOpen = globalThis.localStorage?.getItem('innerlore:hud:drawer') === '1';
        } catch {
            runtime.hudDrawerOpen = false;
        }
    }
    return runtime.hudDrawerOpen;
}

function toggleHudDrawer(open = !hudDrawerOpen()) {
    runtime.hudDrawerOpen = Boolean(open);
    try {
        globalThis.localStorage?.setItem('innerlore:hud:drawer', runtime.hudDrawerOpen ? '1' : '0');
    } catch { /* storage unavailable: the drawer just forgets */ }
    updateCastCards();
}

/**
 * The drawer under the bar: who is with the player (with what they are
 * doing), the explored places around, and the ways into the map.
 */
function buildHudDrawer(store, scene, userName, participants) {
    const drawer = document.createElement('div');
    drawer.className = 'il-hud-drawer';
    const inner = document.createElement('div');
    inner.className = 'il-hud-drawer-inner';
    drawer.append(inner);
    const explored = store ? exploredPlaces(context().chat, store, userName, scene) : null;
    const around = describeSurroundings(store, scene, userName, explored);
    const states = new Map(Object.values(store?.entities || {})
        .filter(entity => entity?.type === 'character')
        .map(entity => [canonicalNameKey(entity.name), cleanString(entity.currentState, 220)]));

    const section = title => {
        const element = document.createElement('section');
        element.className = 'il-hud-section';
        const heading = document.createElement('h4');
        heading.textContent = title;
        const list = document.createElement('ul');
        list.className = 'il-hud-list';
        element.append(heading, list);
        inner.append(element);
        return { element, list };
    };
    const row = (list, { face, title, detail, recent = false, onClick }) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'il-hud-row' + (recent ? ' is-recent' : '');
        let marker = document.createElement('span');
        if (face) {
            marker = face;
        } else {
            marker.className = 'il-hud-place-dot';
        }
        const text = document.createElement('span');
        text.className = 'il-hud-row-text';
        const name = document.createElement('b');
        name.textContent = title;
        const small = document.createElement('small');
        small.textContent = detail;
        text.append(name, small);
        button.append(marker, text);
        button.addEventListener('click', onClick);
        item.append(button);
        list.append(item);
    };
    const empty = (element, message) => {
        const note = document.createElement('p');
        note.className = 'il-hud-empty';
        note.textContent = message;
        element.append(note);
    };

    const people = section('With you');
    for (const person of participants) {
        row(people.list, {
            face: personFace(person.name, 'il-hud-face'),
            title: person.name,
            detail: states.get(canonicalNameKey(person.name)) || (person.recent ? 'Seen recently' : 'In the scene'),
            recent: person.recent,
            onClick: () => showEntityCard(person.name, 'details'),
        });
    }
    if (!participants.length) empty(people.element, 'No one else is here.');

    const places = section(around.here ? `Around ${around.here}` : 'Around here');
    for (const nearby of around.nearby) {
        row(places.list, {
            title: nearby.name,
            detail: nearby.people ? `${nearby.people} ${nearby.people === 1 ? 'person' : 'people'} there` : 'Explored',
            onClick: () => openWorldMap('scene'),
        });
    }
    if (!around.nearby.length) empty(places.element, 'Nothing else explored nearby yet.');
    if (around.hiddenNearby) {
        const note = document.createElement('p');
        note.className = 'il-hud-note';
        note.textContent = `${around.hiddenNearby} unexplored ${around.hiddenNearby === 1 ? 'place' : 'places'} nearby`;
        places.element.append(note);
    }

    const links = document.createElement('div');
    links.className = 'il-hud-links';
    for (const [label, icon, view] of [['World map', HUD_SVG.map, 'world'], ['Around you', HUD_SVG.compass, 'scene']]) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'il-hud-link';
        link.innerHTML = icon;
        link.append(label);
        link.addEventListener('click', () => openWorldMap(view));
        links.append(link);
    }
    inner.append(links);
    return drawer;
}

// The game menu along the bottom of the screen, under the message box. Each
// item opens its own full screen; later screens join this list.
const MENU_ITEMS = [
    {
        id: 'inventory',
        label: 'Inventory',
        icon: () => HUD_SVG.backpack,
        title: store => `Inventory - purse: ${gameOverview(normalizeGameState(store?.game)).purse.text}`,
        shown: settings => settings.gameEnabled !== false,
        open: () => openGamePanel('bag'),
    },
    {
        id: 'trade',
        label: 'Trade',
        icon: () => HUD_SVG.trade,
        title: () => 'Trade - buy, sell, swap, or loot with whoever is here',
        shown: settings => settings.gameEnabled !== false,
        open: () => openTradePanel(),
    },
    {
        id: 'live',
        label: () => (runtime.voiceInput?.live ? 'Live on' : 'Live chat'),
        icon: () => HUD_SVG.live,
        title: () => (runtime.voiceInput?.live ? 'Live chat on: speak, the reply is read, then you are heard again - tap to stop' : 'Live chat: talk instead of typing; each reply is read before you are heard again'),
        shown: settings => settings.voiceInputEnabled !== false,
        open: () => setLiveMode(!voiceInputState().live),
    },
    {
        id: 'voice',
        label: settings => (settings.voiceAutoPlay === false ? 'Voice off' : 'Voice'),
        icon: () => HUD_SVG.voice,
        title: () => {
            const voice = runtime.voice;
            if (voice?.status !== 'ok') return `Voice server: ${voice?.detail || 'not checked yet'} - tap a reply's speaker to retry`;
            return getSettings().voiceAutoPlay === false
                ? 'Voice narration is off - tap to read replies aloud as they arrive'
                : `Voice narration on (${voice.detail}) - tap to stop reading replies as they arrive`;
        },
        shown: settings => settings.voiceEnabled !== false,
        open: () => toggleVoiceAutoPlay(),
    },
];

function renderMenuBar() {
    const settings = getSettings();
    const items = settings.enabled && currentChatId() ? MENU_ITEMS.filter(item => item.shown(settings)) : [];
    let bar = document.getElementById('il_menu_bar');
    if (!items.length) {
        bar?.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement('nav');
        bar.id = 'il_menu_bar';
        bar.setAttribute('aria-label', 'Game menu');
        bar.addEventListener('click', event => {
            const id = event.target.closest('[data-menu]')?.dataset.menu;
            MENU_ITEMS.find(item => item.id === id)?.open();
        });
        watchKeyboard();
    }
    // The last row of SillyTavern's chat column, so the chat makes room for it.
    const host = document.getElementById('sheld') || document.body;
    if (host.lastElementChild !== bar) host.append(bar);
    const store = getChatStore();
    bar.replaceChildren(...items.map(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'il-menu-item';
        button.dataset.menu = item.id;
        button.title = item.title(store);
        button.innerHTML = `${item.icon()}<span></span>`;
        button.querySelector('span').textContent = typeof item.label === 'function' ? item.label(settings) : item.label;
        if (item.id === 'voice') button.classList.toggle('is-off', settings.voiceAutoPlay === false || runtime.voice?.status !== 'ok');
        if (item.id === 'live') button.classList.toggle('is-live', Boolean(runtime.voiceInput?.live));
        return button;
    }));
}

// The open keyboard leaves little room, so the menu steps aside while it is
// up: the message box has focus and the visible screen is well short of its
// full height at this width. Focus alone is not enough, because closing the
// keyboard with Back leaves the box focused.
function watchKeyboard() {
    if (runtime.keyboardWatched) return;
    runtime.keyboardWatched = true;
    let width = 0;
    let fullHeight = 0;
    const update = () => {
        const height = window.visualViewport?.height || window.innerHeight;
        if (window.innerWidth !== width) {
            width = window.innerWidth;
            fullHeight = 0;
        }
        fullHeight = Math.max(fullHeight, height);
        const typing = document.activeElement?.id === 'send_textarea';
        document.body.classList.toggle('il-keyboard', typing && height < fullHeight - 150);
    };
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', () => setTimeout(update, 0));
    update();
}

function openGamePanel(tab = 'bag') {
    if (!runtime.gamePanel) runtime.gamePanel = createGamePanel({ onPerson: name => showEntityCard(name, 'details') });
    const store = getChatStore();
    runtime.gamePanel.refresh(store, displayScene(store), cleanString(context().name1, 100) || 'You');
    runtime.gamePanel.open(tab);
}

// --- Voice narration -------------------------------------------------------------

const VOICE_METADATA_KEY = 'innerlore_voices';
const VOICE_SAMPLE = 'The tide is turning, and the lamps along the harbour wall are lit one by one.';

function voiceState() {
    if (!runtime.voice) {
        runtime.voice = { status: 'unknown', detail: '', engine: '', voices: [], token: 0, speaking: -1, lastProbe: 0, audio: null, controller: null };
    }
    return runtime.voice;
}

/** A request to the voice server: direct when a URL is set, else through the storage plugin. */
/** The fork's voice service, when the extension runs inside the shell. */
function shellVoiceService() {
    const service = typeof window !== 'undefined' ? window.InnerLoreShell?.getService?.('voice') : null;
    return service && typeof service === 'object' ? service : null;
}

function voiceRequest(path, options = {}) {
    const settings = getSettings();
    const service = shellVoiceService();
    const external = service && service.provider !== 'local';
    const direct = external ? '' : cleanString(settings.voiceServerUrl, 300).replace(/\/+$/u, '');
    let url = direct ? `${direct}${path}` : `${settings.storageApiRoot || '/api/plugins/innerlore-storage/v1'}/tts${path}`;
    const base = direct ? {} : (context().getRequestHeaders?.() || {});
    const request = { ...options, headers: { ...base, 'Content-Type': 'application/json', ...(options.headers || {}) } };
    if (external) {
        // The storage plugin forwards to the external provider; it holds the key.
        const descriptor = { provider: service.provider, url: service.url, model: service.model, secretId: service.secretId };
        if (String(options.method || 'GET').toUpperCase() === 'GET') {
            url += `${url.includes('?') ? '&' : '?'}provider=${encodeURIComponent(service.provider)}&url=${encodeURIComponent(service.url || '')}`;
        } else if (typeof request.body === 'string') {
            try {
                request.body = JSON.stringify({ ...JSON.parse(request.body), service: descriptor });
            } catch {
                // not JSON: send as is
            }
        }
    }
    return fetch(url, request);
}

async function probeVoiceServer({ force = false } = {}) {
    const voice = voiceState();
    const settings = getSettings();
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
        voice.status = 'down';
        voice.detail = 'no browser';
        return voice;
    }
    if (!settings.voiceEnabled) {
        voice.status = 'off';
        voice.detail = 'voice narration is off';
        populateVoiceSelects();
        return voice;
    }
    if (!force && Date.now() - voice.lastProbe < 60_000) return voice;
    voice.lastProbe = Date.now();
    try {
        const response = await voiceRequest('/health', { method: 'GET', signal: AbortSignal.timeout(8_000) });
        const payload = await response.json();
        const data = payload?.data ?? payload;
        if (!response.ok || !data?.ok) throw new Error(payload?.error?.message || payload?.error || `HTTP ${response.status}`);
        voice.status = 'ok';
        voice.engine = cleanString(data.engine, 40);
        voice.voices = (Array.isArray(data.voices) ? data.voices : []).filter(entry => entry?.id).slice(0, 200);
        voice.stt = cleanString(data.stt, 40);
        voice.detail = `${voice.engine || 'local'}, ${voice.voices.length} voices${voice.stt ? `, voice input ${voice.stt}` : ', no speech model'}`;
    } catch (error) {
        voice.status = 'down';
        voice.detail = cleanString(error?.message || String(error), 300);
    }
    populateVoiceSelects();
    renderMenuBar();
    return voice;
}

function populateVoiceSelects() {
    if (typeof document === 'undefined') return;
    const voice = voiceState();
    const settings = getSettings();
    for (const [id, key] of [['il_voice_narrator', 'voiceNarrator'], ['il_voice_player', 'voicePlayer'], ['il_voice_unknown', 'voiceUnknown'], ['il_voice_thought', 'voiceThought']]) {
        const select = document.getElementById(id);
        if (!select) continue;
        const wanted = settings[key];
        const blank = [];
        if (key === 'voiceThought' || key === 'voicePlayer') {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = key === 'voicePlayer' ? `Auto from your persona (${personaGender()})` : 'Same as the narrator, quieter';
            option.selected = !wanted;
            blank.push(option);
        }
        select.replaceChildren(...blank, ...voice.voices.map(entry => {
            const option = document.createElement('option');
            option.value = entry.id;
            option.textContent = entry.name || entry.id;
            option.selected = entry.id === wanted;
            return option;
        }));
        if (!voice.voices.length && key !== 'voiceThought' && key !== 'voicePlayer') {
            const option = document.createElement('option');
            option.value = wanted || '';
            option.textContent = wanted ? `${wanted} (server not reached)` : '(no voices yet)';
            option.selected = true;
            select.append(option);
        }
    }
    const status = document.getElementById('il_voice_status');
    if (status) status.textContent = voice.status === 'ok' ? `Voice server ready: ${voice.detail}.` : voice.status === 'off' ? '' : `Voice server: ${voice.detail || 'not checked yet'}.`;
}

function chosenVoices() {
    const records = context().chatMetadata?.[VOICE_METADATA_KEY];
    return records && typeof records === 'object' ? records : {};
}

function setChosenVoice(name, voiceId) {
    const ctx = context();
    if (!ctx.chatMetadata) return;
    const records = { ...chosenVoices() };
    const key = canonicalNameKey(name);
    if (!key) return;
    if (voiceId) records[key] = cleanString(voiceId, 40);
    else delete records[key];
    ctx.chatMetadata[VOICE_METADATA_KEY] = records;
    ctx.saveMetadataDebounced?.();
}

/** The people a reply may quote, with what the story says about them, for the voice cast. */
function voiceCast(store) {
    const people = [];
    const byKey = new Map();
    const playerKey = canonicalNameKey(context().name1 || '');
    for (const entity of Object.values(store?.entities || {})) {
        if (!entity || (entity.type !== 'character' && entity.type !== 'creature') || entity.enabled === false) continue;
        const key = canonicalNameKey(entity.name);
        // The player has their own voice setting and takes no cast voice.
        if (!key || byKey.has(key) || key === playerKey) continue;
        const person = {
            name: entity.name,
            aliases: (entity.aliases || []).slice(0, 6),
            description: [entity.summary, entity.description, ...(Array.isArray(entity.facts) ? entity.facts.slice(0, 6) : [])].filter(Boolean).join(' '),
        };
        byKey.set(key, person);
        people.push(person);
    }
    const game = getSettings().gameEnabled !== false && store ? normalizeGameState(store.game) : null;
    for (const stage of Object.values(game?.stages || {})) {
        for (const person of stage.people || []) {
            const key = canonicalNameKey(person?.name);
            if (!key) continue;
            const about = [person.role, person.appearance, person.manner].filter(Boolean).join(' ');
            const existing = byKey.get(key);
            if (existing) existing.description = `${existing.description} ${about}`.trim();
            else if (person.introduced) {
                const record = { name: person.name, description: about };
                byKey.set(key, record);
                people.push(record);
            }
        }
    }
    return people;
}

function pickVoice(wanted, gender) {
    const voices = voiceState().voices;
    if (voices.some(entry => entry.id === wanted)) return wanted;
    return voices.find(entry => entry.gender === gender)?.id || voices[0]?.id || '';
}

/** The player's gender from their persona and name, for the default voice. */
function personaGender() {
    const ctx = context();
    return inferGender(`${ctx.personaDescription || ''} ${ctx.name1 || ''}`) || 'male';
}

function voicePlan(store) {
    const settings = getSettings();
    const narrator = pickVoice(settings.voiceNarrator, 'female');
    const player = pickVoice(settings.voicePlayer || '', personaGender());
    const people = voiceCast(store);
    const chosen = chosenVoices();
    const unknown = pickVoice(settings.voiceUnknown, 'female');
    const thought = settings.voiceThought ? pickVoice(settings.voiceThought, 'female') : narrator;
    const assignment = castVoices({ people, voices: voiceState().voices, narratorVoice: narrator, playerVoice: player, reserved: [unknown, thought], chosen });
    rememberCast(assignment, chosen, [narrator, player, unknown, thought]);
    return {
        narrator,
        player,
        unknown,
        thought,
        assignment,
        children: new Set(people.filter(isChild).map(person => canonicalNameKey(person.name))),
    };
}

/**
 * A voice, once given to someone, stays theirs: the cast is written into the
 * chat the first time it is drawn, so a newcomer never reshuffles the voices
 * the listener already knows. The person page's Voice select overrides it.
 */
function rememberCast(assignment, chosen, reserved = []) {
    const ctx = context();
    if (!ctx.chatMetadata || !(assignment instanceof Map)) return;
    const records = { ...chosen };
    let changed = false;
    for (const [key, voiceId] of assignment) {
        // A remembered voice that is now the narrator's, the player's or the unknown-speaker voice is replaced.
        if (!key || !voiceId || (records[key] && !reserved.includes(records[key]))) continue;
        records[key] = voiceId;
        changed = true;
    }
    if (!changed) return;
    ctx.chatMetadata[VOICE_METADATA_KEY] = records;
    ctx.saveMetadataDebounced?.();
}

/** The clips a text becomes: text, voice and speed per segment, with where each ends in the text. */
function voiceJobsForText(text, store) {
    const ctx = context();
    const settings = getSettings();
    const plan = voicePlan(store);
    const italics = settings.voiceItalics || 'thought';
    return segmentSpeech(text, { cast: voiceCast(store), playerName: ctx.name1, keepTags: settings.voiceSkipTags === false })
        .map(segment => (segment.kind === 'thought' && italics === 'narrator' ? { ...segment, kind: 'narration', tone: 'plain' } : segment))
        .filter(segment => (segment.kind === 'speech' ? settings.voiceDialogue !== false
            : segment.kind === 'thought' ? italics !== 'skip'
                : settings.voiceNarration !== false))
        .map(segment => ({
            text: toneText(segment.text, segment.tone),
            end: segment.end,
            voice: voiceForSegment(segment, { narratorVoice: plan.narrator, playerVoice: plan.player, unknownVoice: plan.unknown, thoughtVoice: plan.thought, assignment: plan.assignment }),
            ...prosodyFor(segment, settings.voiceSpeed),
            tone: segment.tone,
            kind: segment.kind,
            speaker: segment.speaker || (segment.kind === 'narration' ? 'narrator' : 'someone'),
            child: segment.kind !== 'narration' && !segment.player && Boolean(segment.speaker) && plan.children.has(canonicalNameKey(segment.speaker)),
        }));
}

function voiceJobsForMessage(messageIndex) {
    const message = context().chat?.[messageIndex];
    if (!message || message.is_user || message.is_system) return [];
    return voiceJobsForText(message.mes, getChatStore());
}

async function fetchVoiceClip(job, signal) {
    const settings = getSettings();
    const response = await voiceRequest('/speak', { method: 'POST', body: JSON.stringify({ text: job.text, voice: job.voice, speed: job.speed, tone: job.tone || undefined, kind: job.kind || undefined, quick: job.quick || undefined, takes: settings.voiceTakes || undefined, steps: settings.voiceSteps || undefined, silence: settings.voiceSilence || undefined }), signal });
    if (!response.ok) throw new Error(`voice server answered ${response.status}`);
    return response.arrayBuffer();
}

/** One shared output: clips are scheduled back to back on it, so joins are seamless. */
function voiceOutput() {
    const voice = voiceState();
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!voice.output || voice.output.state === 'closed') {
        voice.output = new AudioContextClass();
        voice.nextStart = 0;
    }
    return voice.output;
}

/** The decoded clip coloured by its tone (pitch, breath, tremor, dullness, edge). */
function colourBuffer(output, buffer, tone, kind = 'speech', child = false) {
    const settings = getSettings();
    const strength = Number(settings.voiceEmotion ?? 1);
    const lift = child ? Number(settings.voiceChildPitch ?? 3) : 0;
    let data = buffer.getChannelData(0);
    // A child's voice is the brightest voice raised a few semitones (formants with it): identity, not mood.
    if (lift > 0) data = pitchShift(data, buffer.sampleRate, lift);
    // Thoughts are read quietly and slowly; no mood processing on them at all.
    const coloured = (!tone || !strength || kind === 'thought') ? data : applyToneEffects(data, buffer.sampleRate, tone, strength);
    if (coloured === buffer.getChannelData(0)) return buffer;
    const result = output.createBuffer(1, coloured.length, buffer.sampleRate);
    result.getChannelData(0).set(coloured);
    return result;
}

/** The clip without the quiet the synthesizer leaves at both ends (a little is kept). */
function trimBuffer(output, buffer, { floor = 0.004, keepMs = 40 } = {}) {
    const data = buffer.getChannelData(0);
    const window = Math.max(1, Math.floor(buffer.sampleRate / 100));
    let start = 0;
    let end = data.length;
    for (let i = 0; i + window <= data.length; i += window) {
        let sum = 0;
        for (let j = i; j < i + window; j += 1) sum += data[j] * data[j];
        if (Math.sqrt(sum / window) > floor) { start = i; break; }
    }
    for (let i = data.length; i - window >= 0; i -= window) {
        let sum = 0;
        for (let j = i - window; j < i; j += 1) sum += data[j] * data[j];
        if (Math.sqrt(sum / window) > floor) { end = i; break; }
    }
    const keep = Math.floor((keepMs / 1_000) * buffer.sampleRate);
    start = Math.max(0, start - keep);
    end = Math.min(data.length, end + keep);
    if (end - start >= data.length - window) return buffer;
    const trimmed = output.createBuffer(1, Math.max(1, end - start), buffer.sampleRate);
    trimmed.getChannelData(0).set(data.subarray(start, end));
    return trimmed;
}

/** Play a decoded clip right after the one before it; resolves when it has ended. */
function playBuffer(output, buffer, { gain = 1, pause = 0 } = {}) {
    const voice = voiceState();
    return new Promise((resolve, reject) => {
        try {
            const source = output.createBufferSource();
            source.buffer = buffer;
            const amp = output.createGain();
            amp.gain.value = Math.min(1.6, Math.max(0.3, Number(gain) || 1));
            source.connect(amp);
            amp.connect(output.destination);
            // The line's own pause (its tone, a trailing ellipsis) replaces the fixed gap when longer.
            const gap = Math.max(Math.max(0, Number(getSettings().voiceGapMs) || 0) / 1_000, Number(pause) || 0);
            const now = output.currentTime;
            const start = voice.nextStart > now + 0.01 ? voice.nextStart : now + 0.02;
            voice.nextStart = start + buffer.duration + gap;
            voice.source = source;
            source.addEventListener('ended', () => resolve(), { once: true });
            source.start(start);
        } catch (error) {
            reject(error);
        }
    });
}

function playClipFallback(arrayBuffer) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'audio/wav' }));
        const audio = new Audio(url);
        voiceState().audio = audio;
        const done = () => { URL.revokeObjectURL(url); resolve(); };
        audio.addEventListener('ended', done, { once: true });
        audio.addEventListener('error', () => { URL.revokeObjectURL(url); reject(new Error('playback failed')); }, { once: true });
        audio.play().catch(reject);
    });
}

function markSpeakingMessage(index) {
    if (typeof document === 'undefined') return;
    for (const element of document.querySelectorAll('#chat .mes.il-speaking')) element.classList.remove('il-speaking');
    if (index >= 0) document.querySelector(`#chat .mes[mesid="${index}"]`)?.classList.add('il-speaking');
}

function stopSpeaking() {
    const voice = voiceState();
    voice.token += 1;
    voice.speaking = -1;
    voice.session = null;
    voice.controller?.abort();
    voice.controller = null;
    try {
        voice.source?.stop();
    } catch {
        // already finished
    }
    voice.source = null;
    voice.nextStart = 0;
    try {
        voice.audio?.pause();
    } catch {
        // nothing to stop
    }
    voice.audio = null;
    markSpeakingMessage(-1);
}

/**
 * A reading session: jobs are appended as text arrives, synthesized a few
 * ahead, decoded, trimmed and scheduled back to back. `done()` closes it once
 * the last job is queued.
 */
function startVoiceSession(messageIndex) {
    const voice = voiceState();
    stopSpeaking();
    const token = voice.token;
    const controller = new AbortController();
    voice.controller = controller;
    const session = { token, messageIndex, jobs: [], queued: 0, finished: false, pending: [], ahead: 3, playing: null };
    voice.session = session;
    voice.speaking = messageIndex;
    markSpeakingMessage(messageIndex);
    const output = voiceOutput();
    const alive = () => voice.token === token;
    const pump = () => {
        if (!alive()) return;
        while (session.pending.length < session.ahead && session.queued < session.jobs.length) {
            // The first clip is marked quick: the server skips its pitch redraws so the reading starts at once.
            const job = { ...session.jobs[session.queued], quick: session.queued === 0 };
            session.queued += 1;
            const clip = fetchVoiceClip(job, controller.signal)
                .then(bytes => (output ? output.decodeAudioData(bytes.slice(0)).then(buffer => ({ buffer: trimBuffer(output, colourBuffer(output, buffer, job.tone, job.kind, job.child)) })) : { bytes }))
                .catch(error => ({ error }));
            session.pending.push({ job, clip });
        }
        if (!session.playing) void play();
    };
    const play = async () => {
        session.playing = (async () => {
            while (alive()) {
                const entry = session.pending.shift();
                if (!entry) break;
                const clip = await entry.clip;
                if (!alive()) return;
                pump();
                if (clip?.error) {
                    if (clip.error?.name !== 'AbortError') console.warn(`${LOG_PREFIX} voice segment skipped:`, clip.error);
                    continue;
                }
                try {
                    if (clip.buffer && output) await playBuffer(output, clip.buffer, { gain: entry.job.gain, pause: entry.job.pause });
                    else if (clip.bytes) await playClipFallback(clip.bytes);
                } catch (error) {
                    if (error?.name === 'NotAllowedError') {
                        toastr.info('Tap the speaker on a reply once to allow voice narration.', DISPLAY_NAME);
                        stopSpeaking();
                        return;
                    }
                    console.warn(`${LOG_PREFIX} voice playback:`, error);
                }
            }
            session.playing = null;
            if (alive() && session.finished && session.queued >= session.jobs.length && !session.pending.length) {
                voice.speaking = -1;
                voice.session = null;
                markSpeakingMessage(-1);
                liveAfterReply();
            }
        })();
        await session.playing;
    };
    return {
        add(jobs) {
            if (!alive() || !jobs.length) return;
            session.jobs.push(...jobs);
            pump();
        },
        done() {
            session.finished = true;
            if (alive() && !session.playing && session.queued >= session.jobs.length && !session.pending.length) {
                voice.speaking = -1;
                voice.session = null;
                markSpeakingMessage(-1);
                liveAfterReply();
            }
        },
        get count() { return session.jobs.length; },
        get messageIndex() { return messageIndex; },
        alive,
    };
}

/**
 * Read one reply aloud: the narration in the narrator's voice and each
 * person's lines in theirs. `manual` is a tap on the speaker, which also
 * counts as the user gesture the browser wants before audio may start.
 */
async function speakMessage(messageIndex, { manual = false } = {}) {
    const voice = voiceState();
    const settings = getSettings();
    if (!settings.enabled || !settings.voiceEnabled) return;
    if (voice.status !== 'ok') await probeVoiceServer({ force: manual });
    if (voice.status !== 'ok') {
        if (manual) toastr.warning(`Voice server: ${voice.detail || 'not reachable'}`, DISPLAY_NAME);
        return;
    }
    if (manual) void voiceOutput()?.resume?.();
    const jobs = voiceJobsForMessage(messageIndex);
    if (!jobs.length) return;
    log(`Voice: reading message ${messageIndex} in ${jobs.length} segment(s) (${[...new Set(jobs.map(job => job.speaker))].join(', ')}).`);
    const session = startVoiceSession(messageIndex);
    session.add(jobs);
    session.done();
}

/**
 * Read along while the reply streams: every sentence that enough text
 * already follows is spoken while the rest is still being written.
 */
function voiceStreamProgress(text) {
    const settings = getSettings();
    if (typeof window === 'undefined') return;
    if (!settings.enabled || !settings.voiceEnabled || settings.voiceAutoPlay === false || settings.voiceStreaming === false) return;
    if (!runtime.activeStoryGenerationId || runtime.storyGenerationType === 'quiet' || runtime.storyGenerationType === 'impersonate') return;
    const voice = voiceState();
    if (voice.status !== 'ok') return;
    const content = String(text || '');
    // A tool call written as text is not read.
    if (/^\s*(?:call:|\{|```)/u.test(content)) return;
    const ctx = context();
    const messageIndex = ctx.chat.length - 1;
    const now = Date.now();
    if (voice.streamAt && now - voice.streamAt < 350 && !voice.streamTimer) {
        voice.streamTimer = setTimeout(() => {
            voice.streamTimer = null;
            voiceStreamProgress(voice.streamText);
        }, 350);
        voice.streamText = content;
        return;
    }
    voice.streamText = content;
    voice.streamAt = now;
    const generationId = runtime.activeStoryGenerationId;
    let session = voice.session;
    if (!session || session.generationId !== generationId) {
        if (content.trim().length < 40) return;
        session = startVoiceSession(messageIndex);
        session.generationId = generationId;
        voice.session = session;
        session.streamJobs = 0;
    }
    const jobs = voiceJobsForText(content, getChatStore());
    const settled = settledSegmentCount(jobs, cleanForSpeech(content).length, 60);
    if (settled > session.streamJobs) {
        session.add(jobs.slice(session.streamJobs, settled));
        session.streamJobs = settled;
    }
}

/** The reply is complete: what the stream did not reach is read now, or the whole reply when nothing streamed. */
function voiceStreamFinish(messageIndex) {
    const voice = voiceState();
    if (voice.streamTimer) {
        clearTimeout(voice.streamTimer);
        voice.streamTimer = null;
    }
    const session = voice.session;
    if (!session || session.messageIndex !== messageIndex || !session.alive()) return false;
    const jobs = voiceJobsForMessage(messageIndex);
    if (jobs.length > session.streamJobs) session.add(jobs.slice(session.streamJobs));
    session.streamJobs = jobs.length;
    session.done();
    return true;
}

async function speakSample(voiceId, name = '') {
    stopSpeaking();
    const voice = voiceState();
    const token = voice.token;
    const controller = new AbortController();
    voice.controller = controller;
    const output = voiceOutput();
    void output?.resume?.();
    try {
        const bytes = await fetchVoiceClip({ text: `${name ? `${name}. ` : ''}${VOICE_SAMPLE}`, voice: voiceId, speed: getSettings().voiceSpeed || 1 }, controller.signal);
        if (voice.token !== token) return;
        if (output) await playBuffer(output, trimBuffer(output, await output.decodeAudioData(bytes.slice(0))));
        else await playClipFallback(bytes);
    } catch (error) {
        if (error?.name !== 'AbortError') toastr.warning(`Voice: ${error?.message || error}`, DISPLAY_NAME);
    }
}

function scheduleAutoVoice(messageIndex) {
    const settings = getSettings();
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    if (!settings.enabled || !settings.voiceEnabled || settings.voiceAutoPlay === false) return;
    if (voiceStreamFinish(messageIndex)) return;
    setTimeout(() => {
        if (context().chat.length - 1 !== messageIndex || runtime.pendingTextToolCalls) return;
        if (voiceState().session?.messageIndex === messageIndex) return;
        void speakMessage(messageIndex);
    }, 400);
}

function toggleVoiceAutoPlay() {
    const settings = getSettings();
    settings.voiceAutoPlay = settings.voiceAutoPlay === false;
    saveSettings();
    if (!settings.voiceAutoPlay) stopSpeaking();
    else if (voiceState().status !== 'ok') void probeVoiceServer({ force: true });
    const checkbox = typeof document !== 'undefined' ? document.getElementById?.('il_voice_autoplay') : null;
    if (checkbox) checkbox.checked = settings.voiceAutoPlay;
    renderMenuBar();
}

/** A speaker on every reply: tap to read it, tap again to stop. */
function ensureVoiceButtons() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    const settings = getSettings();
    for (const mes of document.querySelectorAll('#chat .mes')) {
        const existing = mes.querySelector('.il-voice-btn');
        const eligible = settings.enabled && settings.voiceEnabled && mes.getAttribute('is_user') !== 'true' && mes.getAttribute('is_system') !== 'true';
        if (!eligible) {
            existing?.remove();
            continue;
        }
        if (existing) continue;
        const host = mes.querySelector('.extraMesButtons');
        if (!host) continue;
        const button = document.createElement('div');
        button.className = 'mes_button il-voice-btn fa-solid fa-volume-high interactable';
        button.title = 'Read aloud (InnerLore voice)';
        button.tabIndex = 0;
        host.prepend(button);
    }
    markSpeakingMessage(voiceState().speaking);
}

function bindVoiceButtons() {
    const chat = typeof document !== 'undefined' ? document.getElementById('chat') : null;
    if (!chat || runtime.voiceButtonsBound) return;
    runtime.voiceButtonsBound = true;
    chat.addEventListener('click', event => {
        const button = event.target.closest?.('.il-voice-btn');
        if (!button) return;
        const index = Number(button.closest('.mes')?.getAttribute('mesid'));
        if (!Number.isInteger(index)) return;
        if (voiceState().speaking === index) stopSpeaking();
        else void speakMessage(index, { manual: true });
    });
}

/** The voice picker on someone's page, with a line to hear it. */
function fillEntityVoice(popup) {
    const settings = getSettings();
    const voice = voiceState();
    if (!settings.voiceEnabled || voice.status !== 'ok' || !voice.voices.length) return;
    const name = popup.dataset.name || '';
    const key = canonicalNameKey(name);
    if (!key) return;
    const plan = voicePlan(getChatStore());
    const current = chosenVoices()[key] || plan.assignment.get(key) || plan.unknown;
    const row = document.createElement('div');
    row.className = 'il-entity-voice';
    row.innerHTML = '<label><span>Voice</span><select class="text_pole"></select></label><button type="button" class="il-entity-hear">Hear</button>';
    const select = row.querySelector('select');
    for (const entry of voice.voices) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name || entry.id;
        option.selected = entry.id === current;
        select.append(option);
    }
    select.addEventListener('change', () => setChosenVoice(name, select.value));
    row.querySelector('.il-entity-hear').addEventListener('click', () => void speakSample(select.value, name));
    const slot = popup.querySelector('.il-entity-portrait-slot');
    if (slot) slot.after(row);
    else popup.querySelector('.il-entity-body')?.prepend(row);
}

// --- Voice input: speak instead of typing ---------------------------------------

function voiceInputState() {
    if (!runtime.voiceInput) runtime.voiceInput = { recording: false, busy: false, stream: null, context: null, node: null, chunks: [], tracker: null, recognition: null, live: false, livePhase: 'off', liveTimer: null };
    return runtime.voiceInput;
}

/**
 * Live chat: speak, the words are sent, the reply is read, and the
 * microphone listens again. Phases: listening -> sending -> waiting (for the
 * reply and its narration) -> listening. Off on a tap, a failure, or when
 * the page goes to the background.
 */
function setLiveMode(on, { fromSettings = false } = {}) {
    const input = voiceInputState();
    const settings = getSettings();
    if (on && !voiceInputAvailable()) {
        toastr.warning('Voice input is not available here.', DISPLAY_NAME);
        on = false;
    }
    input.live = Boolean(on);
    if (!fromSettings && settings.voiceLive !== input.live) {
        settings.voiceLive = input.live;
        saveSettings();
        const checkbox = typeof document !== 'undefined' ? document.getElementById?.('il_voice_live') : null;
        if (checkbox) checkbox.checked = input.live;
    }
    clearTimeout(input.liveTimer);
    input.liveTimer = null;
    if (input.live) {
        input.livePhase = 'listening';
        void voiceOutput()?.resume?.();
        if (!input.recording && !input.busy) void startVoiceInput();
    } else {
        input.livePhase = 'off';
        if (input.recording) {
            if (input.recognition) input.recognition.abort?.();
            else releaseVoiceInput();
            input.chunks = [];
        }
    }
    setMicState(input.recording ? 'recording' : input.busy ? 'busy' : 'idle');
    renderMenuBar();
}

/** Listen again after the reply has been read (or arrived, when nothing is read). */
function liveListenSoon(delay = 600) {
    const input = voiceInputState();
    if (!input.live || input.recording || input.busy) return;
    clearTimeout(input.liveTimer);
    input.livePhase = 'listening';
    input.liveTimer = setTimeout(() => {
        input.liveTimer = null;
        if (!input.live || input.recording || input.busy) return;
        if (runtime.activeStoryGenerationId || voiceState().session) return;
        void startVoiceInput();
    }, delay);
}

/** The reply's narration ended (or there was none): a live chat listens again. */
function liveAfterReply() {
    const input = voiceInputState();
    if (!input.live || input.livePhase !== 'waiting') return;
    if (runtime.activeStoryGenerationId) return;
    if (voiceState().session) return;
    liveListenSoon(500);
}

function voiceInputAvailable() {
    const settings = getSettings();
    if (!settings.enabled || settings.voiceInputEnabled === false || typeof navigator === 'undefined') return false;
    if (settings.voiceInputProvider === 'browser') return Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
    return Boolean(navigator.mediaDevices?.getUserMedia);
}

const VOICE_TAG_SCRIPT = 'InnerLore voice tags (hidden)';

/**
 * The reader never sees [[Name|tone]]: a global regex script alters the chat
 * display only (the stored text and the prompt keep the tags, so the story
 * model keeps writing them and the voice reader can use them).
 */
function ensureVoiceTagRegex() {
    const ctx = context();
    const settings = getSettings();
    const scripts = ctx.extensionSettings?.regex;
    if (!Array.isArray(scripts)) return;
    const wanted = Boolean(settings.enabled && settings.voiceEnabled && settings.voiceTags !== false);
    const index = scripts.findIndex(script => script?.scriptName === VOICE_TAG_SCRIPT);
    if (!wanted) {
        if (index >= 0) {
            scripts.splice(index, 1);
            ctx.saveSettingsDebounced?.();
        }
        return;
    }
    if (index >= 0) return;
    scripts.push({
        id: `innerlore-voice-tags-${Date.now().toString(36)}`,
        scriptName: VOICE_TAG_SCRIPT,
        findRegex: '/\\[\\[\\s*[^\\]|]{1,60}?\\s*(?:\\|\\s*[^\\]]{0,40}?\\s*)?\\]\\][ \\t]*/g',
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    });
    ctx.saveSettingsDebounced?.();
    log('Voice tags are hidden from the chat display (regex script added).');
}

/** Earlier voice defaults that turned out wrong are moved once; a chosen voice is never touched. */
function migrateVoiceDefaults() {
    const settings = getSettings();
    let changed = false;
    if (settings.voicePlayer === 's5' && !settings.voicePlayerVersion) {
        settings.voicePlayer = '';
        settings.voicePlayerVersion = 1;
        changed = true;
    }
    // The first narrator default (Female 3) hisses above the voice band; the cleanest female voice replaces it.
    if (settings.voiceNarrator === 's2' && !settings.voiceNarratorVersion) {
        settings.voiceNarrator = 's1';
        if (settings.voiceUnknown === 's1') settings.voiceUnknown = 's3';
        settings.voiceNarratorVersion = 1;
        changed = true;
    }
    if (changed) saveSettings();
}

/** The microphone button beside Send: tap to talk, tap again to finish early. */
function ensureMicButton() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const form = document.getElementById('rightSendForm');
    const existing = document.getElementById('il_mic_button');
    if (!form) return;
    if (!voiceInputAvailable()) {
        existing?.remove();
        return;
    }
    if (existing) return;
    const button = document.createElement('div');
    button.id = 'il_mic_button';
    button.className = 'fa-solid fa-microphone interactable';
    button.title = 'Speak your turn (InnerLore voice input)';
    button.tabIndex = 0;
    let pressTimer = null;
    let longPressed = false;
    const press = () => {
        longPressed = false;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            longPressed = true;
            setLiveMode(!voiceInputState().live);
            toastr.info(voiceInputState().live ? 'Live chat on: speak, and the reply is read before you are heard again. Hold the microphone to stop.' : 'Live chat off.', DISPLAY_NAME);
        }, 650);
    };
    const release = () => clearTimeout(pressTimer);
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('click', () => {
        if (longPressed) return;
        void toggleVoiceInput();
    });
    const send = document.getElementById('send_but');
    if (send) form.insertBefore(button, send);
    else form.append(button);
}

function setMicState(state, note = '') {
    const button = typeof document !== 'undefined' ? document.getElementById('il_mic_button') : null;
    if (!button) return;
    button.classList.toggle('is-recording', state === 'recording');
    button.classList.toggle('is-busy', state === 'busy');
    const live = voiceInputState().live;
    button.classList.toggle('is-live', live);
    button.title = state === 'recording' ? `Listening - tap when you are done${live ? ' (live chat: tap and hold to leave)' : ''}` : state === 'busy' ? 'Transcribing…' : live ? 'Live chat: waiting for the reply' : note || 'Speak your turn (InnerLore voice input)';
}

async function toggleVoiceInput() {
    const input = voiceInputState();
    if (input.busy) return;
    if (input.recording) {
        if (input.recognition) input.recognition.stop();
        else await finishVoiceInput();
        return;
    }
    await startVoiceInput();
}

async function startVoiceInput() {
    const settings = getSettings();
    const input = voiceInputState();
    stopSpeaking();
    if (settings.voiceInputProvider === 'browser') return startBrowserRecognition();
    input.typedBefore = document.getElementById('send_textarea')?.value?.trim() || '';
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        const audioContext = new AudioContextClass();
        await audioContext.resume?.();
        const source = audioContext.createMediaStreamSource(stream);
        const node = audioContext.createScriptProcessor(4096, 1, 1);
        input.chunks = [];
        input.tracker = createSilenceTracker();
        input.stream = stream;
        input.context = audioContext;
        input.node = node;
        input.recording = true;
        input.partialBusy = false;
        input.partialText = '';
        input.partialAt = 0;
        node.onaudioprocess = event => {
            if (!input.recording) return;
            const samples = new Float32Array(event.inputBuffer.getChannelData(0));
            input.chunks.push(samples);
            if (input.tracker.feed(samples, audioContext.sampleRate) === 'done') {
                void finishVoiceInput();
                return;
            }
            // What has been said so far shows in the message box as it is said.
            if (input.tracker.heardSpeech && !input.partialBusy && Date.now() - input.partialAt > 1_400) void transcribePartial();
        };
        source.connect(node);
        node.connect(audioContext.destination);
        setMicState('recording');
    } catch (error) {
        console.warn(`${LOG_PREFIX} microphone:`, error);
        toastr.warning(error?.name === 'NotAllowedError' ? 'Microphone access was refused.' : `Microphone: ${error?.message || error}`, DISPLAY_NAME);
        releaseVoiceInput();
    }
}

/** A rolling transcript of the recording so far, shown while the speaker is still talking. */
async function transcribePartial() {
    const input = voiceInputState();
    if (!input.recording || input.partialBusy || !input.context) return;
    input.partialBusy = true;
    input.partialAt = Date.now();
    try {
        const samples = resample(concatChunks(input.chunks), input.context.sampleRate, TARGET_RATE);
        if (samples.length < TARGET_RATE / 2) return;
        const wav = encodeWav(samples, TARGET_RATE);
        const response = await voiceRequest('/transcribe', { method: 'POST', body: JSON.stringify({ audio: bytesToBase64(wav) }), signal: AbortSignal.timeout(20_000) });
        const payload = await response.json().catch(() => ({}));
        const data = payload?.data ?? payload;
        const text = String(data?.text || '').trim();
        if (!input.recording || !text || text === input.partialText) return;
        input.partialText = text;
        showPartialTranscript(text);
    } catch (error) {
        console.debug(`${LOG_PREFIX} partial transcript:`, error?.message || error);
    } finally {
        input.partialBusy = false;
        input.partialAt = Date.now();
    }
}

function showPartialTranscript(text) {
    const box = document.getElementById('send_textarea');
    if (!box) return;
    const input = voiceInputState();
    // Replace the previous partial, keep anything typed before the recording began.
    const base = input.typedBefore ?? '';
    box.value = base ? `${base.trimEnd()}\n${text}` : text;
    runtime.lastFilledChoice = box.value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
}

function releaseVoiceInput() {
    const input = voiceInputState();
    input.recording = false;
    try { input.node?.disconnect(); } catch { /* already gone */ }
    try { input.stream?.getTracks().forEach(track => track.stop()); } catch { /* already gone */ }
    void input.context?.close?.().catch(() => {});
    input.node = null;
    input.stream = null;
    input.context = null;
    setMicState('idle');
}

async function finishVoiceInput() {
    const input = voiceInputState();
    if (!input.recording || input.busy) return;
    input.recording = false;
    const rate = input.context?.sampleRate || TARGET_RATE;
    const chunks = input.chunks;
    input.chunks = [];
    const heard = input.tracker?.heardSpeech;
    releaseVoiceInput();
    if (!chunks.length || !heard) {
        setMicState('idle', 'Nothing heard - tap and speak');
        if (input.live) liveListenSoon(300);
        return;
    }
    input.busy = true;
    setMicState('busy');
    try {
        const samples = trimSilence(resample(concatChunks(chunks), rate, TARGET_RATE), TARGET_RATE);
        if (!samples.length) return;
        const wav = encodeWav(samples, TARGET_RATE);
        const response = await voiceRequest('/transcribe', { method: 'POST', body: JSON.stringify({ audio: bytesToBase64(wav) }), signal: AbortSignal.timeout(90_000) });
        const payload = await response.json().catch(() => ({}));
        const data = payload?.data ?? payload;
        if (!response.ok || !data || data.ok === false) throw new Error(payload?.error?.message || data?.error || `HTTP ${response.status}`);
        input.busy = false;
        deliverTranscript(tidyTranscript(data.text));
    } catch (error) {
        console.warn(`${LOG_PREFIX} transcription:`, error);
        toastr.warning(`Voice input: ${cleanString(error?.message || String(error), 200)}`, DISPLAY_NAME);
        if (input.live) liveListenSoon(1_500);
    } finally {
        input.busy = false;
        setMicState('idle');
    }
}

/** The browser's own recognizer (Chrome on Android uses the system speech service). */
function startBrowserRecognition() {
    const input = voiceInputState();
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) {
        toastr.warning('This browser has no speech recognition; switch voice input to the local server.', DISPLAY_NAME);
        return;
    }
    const recognition = new Recognition();
    recognition.lang = getSettings().voiceInputLanguage || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    input.typedBefore = document.getElementById('send_textarea')?.value?.trim() || '';
    let text = '';
    recognition.onresult = event => {
        text = Array.from(event.results).map(result => result[0]?.transcript || '').join(' ');
        if (text.trim()) {
            input.partialText = text;
            showPartialTranscript(text.trim());
        }
    };
    recognition.onerror = event => {
        if (event.error !== 'aborted' && event.error !== 'no-speech') toastr.warning(`Voice input: ${event.error}`, DISPLAY_NAME);
    };
    recognition.onend = () => {
        input.recording = false;
        input.recognition = null;
        setMicState('idle');
        if (text.trim()) deliverTranscript(tidyTranscript(text));
        else if (input.live) liveListenSoon(300);
    };
    input.recognition = recognition;
    input.recording = true;
    setMicState('recording');
    recognition.start();
}

function deliverTranscript(text) {
    const input = voiceInputState();
    // The live partial made the box's text ours: the final words replace it.
    if (input.partialText) {
        const box = document.getElementById('send_textarea');
        if (box) {
            box.value = input.typedBefore || '';
            runtime.lastFilledChoice = '';
        }
        input.partialText = '';
    }
    if (!text) {
        if (input.live) {
            liveListenSoon(300);
            return;
        }
        toastr.info('Nothing was heard.', DISPLAY_NAME);
        return;
    }
    fillMessageBox(text, { focus: false });
    if (getSettings().voiceInputMode === 'send' || input.live) {
        const send = document.getElementById('send_but');
        if (send && !send.classList.contains('displayNone')) {
            input.livePhase = 'waiting';
            send.click();
            keepKeyboardDown();
        } else {
            toastr.info('Not connected: your words are in the message box.', DISPLAY_NAME);
            if (input.live) liveListenSoon(2_000);
        }
    }
}

// --- Game actions: the game system applies what the player does ----------------

/** The index of the player message this turn answers; -1 when there is none. */
function turnPlayerIndex() {
    return lastPlayerMessageIndex(context().chat || []);
}

/** This turn's record of applied actions, started afresh for a new turn. */
function ensureTurnActions(reset = false) {
    const chatId = currentChatId();
    const playerIndex = turnPlayerIndex();
    const current = runtime.turnActions;
    if (!reset && current && current.chatId === chatId && current.playerIndex === playerIndex) return current;
    runtime.turnActions = { chatId, playerIndex, outcomes: [], rounds: 0, closed: false, reply: -1 };
    return runtime.turnActions;
}

/**
 * A swipe or regenerate replaces a reply: the game actions that reply made
 * are discarded from the journal, and the new reply may make its own.
 */
function beginTurnActions(generationType) {
    if (getSettings().gameEnabled === false || !['swipe', 'regenerate'].includes(generationType)) return;
    const ctx = context();
    const replyIndex = ctx.chat.length - 1;
    const turn = ensureTurnActions(true);
    turn.reply = replyIndex;
    const store = getChatStore();
    if (!store) return;
    const before = normalizeGameState(store.game).journal.length;
    store.game = gameStateWithout(store.game, entry => entry.source === ACTION_SOURCE && entry.reply === replyIndex);
    if (store.game.journal.length !== before) {
        log(`A ${generationType} discards ${before - store.game.journal.length} game action(s) of the reply it replaces.`);
        void saveChatStore().catch(error => console.warn(`${LOG_PREFIX} Could not save after discarding game actions:`, error));
        updateInjection();
    }
}

/** Whether the story model is offered the game tools on this connection. */
function gameToolsOffered() {
    const settings = getSettings();
    if (!settings.enabled || settings.gameEnabled === false || settings.gameToolsEnabled === false) return false;
    if (storyIsTextCompletion()) return false;
    const ctx = context();
    return ctx.mainApi === 'openai' && Boolean(ctx.chatCompletionSettings?.function_calling);
}

/** What the packet tells the narrator about this turn's actions and the tools. */
function turnActionsForPrompt() {
    const settings = getSettings();
    if (settings.gameEnabled === false) return null;
    const turn = runtime.turnActions;
    const current = turn && turn.chatId === currentChatId() && turn.playerIndex === turnPlayerIndex() ? turn : null;
    const offered = gameToolsOffered();
    return {
        resolved: renderResolvedActions(current?.outcomes || [], { toolsOffered: offered && !current?.closed }),
        guidance: renderToolGuidance({ offered, resolved: Boolean(current?.closed) }),
    };
}

function gameActionContext(store) {
    const ctx = context();
    const scene = displayScene(store);
    return {
        ...gameContext(normalizeGameState(store.game), { playerName: ctx.name1, entities: store.entities, scenePlace: gamePlaceOf(scene, store) }),
        present: (scene?.participants || []).map(person => person.name),
    };
}

/**
 * Apply game actions now: each is checked against the state, journaled under
 * this turn, and the packet is rebuilt so the story narrates the result.
 * Returns one outcome per action.
 */
async function applyGameActionsNow(actions, { via = 'tool' } = {}) {
    const store = getChatStore();
    if (!store || getSettings().gameEnabled === false) {
        return actions.map(action => ({ ok: false, kind: action?.kind, action, text: '', reason: 'The game state is not available in this chat.' }));
    }
    const ctx = context();
    const turn = ensureTurnActions();
    const at = Math.max(0, turn.playerIndex);
    const replyIndex = turn.reply >= 0 ? turn.reply : ctx.chat.length;
    const outcomes = [];
    for (const action of actions) {
        const result = resolveGameAction(store.game, action, gameActionContext(store));
        const outcome = result.outcome;
        if (outcome.ok && result.ops.length) {
            if (actionAlreadyApplied(store.game, result.ops, at)) {
                outcome.text = `${outcome.text} (already applied this turn)`;
                outcome.repeated = true;
            } else {
                const applied = applyGameOperations(store.game, result.ops, { messageIndex: at, source: ACTION_SOURCE });
                store.game = applied.state;
                const sequences = new Set(applied.applied.map(entry => entry.seq));
                for (const entry of store.game.journal) if (sequences.has(entry.seq)) entry.reply = replyIndex;
                if (applied.rejected.length) {
                    outcome.ok = false;
                    outcome.reason = `${outcome.text} (rejected: ${applied.rejected.map(item => item.reason).join('; ')})`;
                }
            }
        }
        outcomes.push(outcome);
        turn.outcomes.push(outcome);
        log(`Game action (${via}): ${outcome.ok ? 'done' : 'not done'} - ${outcome.text || outcome.reason}`);
    }
    if (via !== 'panel') {
        turn.rounds += 1;
        if (turn.rounds >= 2 || turn.outcomes.length >= 8) turn.closed = true;
    }
    updateInjection();
    try {
        updateCastCards();
        const playerLabel = cleanString(ctx.name1, 100) || 'You';
        if (runtime.gamePanel?.isOpen()) runtime.gamePanel.refresh(store, displayScene(store), playerLabel);
        if (runtime.tradePanel?.isOpen()) runtime.tradePanel.refresh(store, displayScene(store), playerLabel);
    } catch (error) {
        console.warn(`${LOG_PREFIX} HUD refresh after game actions:`, error);
    }
    await saveChatStore().catch(error => console.warn(`${LOG_PREFIX} Could not save game actions:`, error));
    return outcomes;
}

function outcomeReply(outcome) {
    return outcome.ok ? `DONE: ${outcome.text}` : `NOT DONE: ${outcome.reason}`;
}

function parseToolArguments(args) {
    if (args && typeof args === 'object') return args;
    if (typeof args === 'string') {
        try {
            return JSON.parse(args);
        } catch {
            return parseGemmaArguments(args.replace(/^\s*\{|\}\s*$/gu, ''));
        }
    }
    return {};
}

/** The game tools, offered to the story model while a story turn is being written. */
function registerGameTools() {
    const ctx = context();
    if (typeof ctx.registerFunctionTool !== 'function') {
        console.warn(`${LOG_PREFIX} SillyTavern does not expose function tools; game actions arrive as text calls only.`);
        return;
    }
    for (const tool of GAME_TOOLS) {
        ctx.registerFunctionTool({
            name: tool.name,
            displayName: tool.displayName,
            description: tool.description,
            parameters: tool.parameters,
            shouldRegister: () => gameToolsOffered() && Boolean(runtime.activeStoryGenerationId)
                && !['quiet', 'impersonate', 'continue'].includes(runtime.storyGenerationType) && !ensureTurnActions().closed,
            formatMessage: args => {
                const parsed = parseToolArguments(args);
                return `InnerLore game: ${parsed.action || tool.name.replace('game_', '')} ${parsed.item || parsed.amount || ''}`.trim();
            },
            action: async args => {
                const action = actionFromToolCall(tool.name, parseToolArguments(args));
                if (!action) return `NOT DONE: ${tool.name} needs a valid action and item.`;
                const [outcome] = await applyGameActionsNow([action], { via: 'tool' });
                return outcomeReply(outcome);
            },
            stealth: false,
        });
    }
}

/**
 * A reply that is a tool call written as text (a provider without a tool
 * parser): hold it; after the generation ends the calls are applied, the
 * call text removed, and the narration asked for.
 */
function interceptTextToolCalls(messageIndex) {
    const settings = getSettings();
    if (!settings.enabled || settings.gameEnabled === false || settings.gameToolsEnabled === false) return false;
    const message = context().chat?.[messageIndex];
    if (!message || message.is_user || message.is_system) return false;
    const parsed = parseTextToolCalls(message.mes);
    if (!parsed.calls.length) return false;
    runtime.pendingTextToolCalls = { chatId: currentChatId(), messageIndex, calls: parsed.calls, rest: parsed.rest };
    log(`The story model wrote ${parsed.calls.length} game tool call(s) as text; InnerLore applies them and asks for the narration.`);
    showNarratorPill('Applying game actions');
    return true;
}

async function finishTextToolCalls() {
    const pending = runtime.pendingTextToolCalls;
    runtime.pendingTextToolCalls = null;
    if (!pending || pending.chatId !== currentChatId()) return;
    const ctx = context();
    const message = ctx.chat?.[pending.messageIndex];
    if (!message) return;
    try {
        const actions = pending.calls.map(call => actionFromToolCall(call.name, call.arguments)).filter(Boolean);
        if (actions.length) await applyGameActionsNow(actions, { via: 'text' });
        const prose = cleanString(pending.rest, 10_000);
        if (prose.length >= 40) {
            // The call rode inside a narrated reply: the prose stays, the call text goes.
            message.mes = prose;
            ctx.updateMessageBlock?.(pending.messageIndex, message);
            await ctx.saveChat?.();
            return;
        }
        if (pending.messageIndex !== ctx.chat.length - 1) return;
        await ctx.deleteLastMessage?.();
        updateInjection();
        await ctx.generate('normal');
    } catch (error) {
        console.error(`${LOG_PREFIX} Could not finish the text tool calls:`, error);
    }
}

/** A trade button: its sentence goes into the message box, its action waits for the send. */
function queuePanelAction(text, action) {
    fillMessageBox(text);
    if (!action) return;
    runtime.pendingPanelActions = [
        ...(runtime.pendingPanelActions || []).filter(item => Date.now() - item.at < 30 * 60_000),
        { text, action, at: Date.now() },
    ];
}

/** The trade-screen actions whose sentences were just sent are applied before the story sees the turn. */
function resolvePanelActions() {
    const pending = runtime.pendingPanelActions || [];
    if (!pending.length) return;
    const chat = context().chat || [];
    const message = chat[chat.length - 1];
    if (!message?.is_user) return;
    const sent = String(message.mes || '');
    const matched = pending.filter(item => sent.includes(item.text));
    runtime.pendingPanelActions = [];
    if (!matched.length) return;
    void applyGameActionsNow(matched.map(item => item.action), { via: 'panel' });
}

/** What the game system applied while the passage was written, for the ledger to skip. */
function alreadyRecordedLines(store, start, end, playerName) {
    const game = normalizeGameState(store.game);
    return actionEntriesInRange(game, start, end).map(entry => entryText(entry, game, playerName)).filter(Boolean);
}

/**
 * Tool calls need SillyTavern's function calling on, and prompt
 * post-processing that keeps tool messages. Done once, when the setting is on.
 */
function ensureToolCallingSetup() {
    const settings = getSettings();
    if (settings.gameToolsEnabled === false || (settings.gameToolsSetupVersion || 0) >= 1) return;
    const ctx = context();
    let changed = false;
    const upgrades = { semi: 'semi_tools', merge: 'merge_tools', strict: 'strict_tools', claude: 'merge_tools' };
    const chat = ctx.chatCompletionSettings;
    if (chat && chat.function_calling !== true) {
        chat.function_calling = true;
        const checkbox = typeof document !== 'undefined' ? document.getElementById?.('openai_function_calling') : null;
        if (checkbox) checkbox.checked = true;
        changed = true;
    }
    if (chat && upgrades[chat.custom_prompt_post_processing]) {
        chat.custom_prompt_post_processing = upgrades[chat.custom_prompt_post_processing];
        changed = true;
    }
    const profiles = ctx.extensionSettings?.connectionManager?.profiles;
    for (const profile of Array.isArray(profiles) ? profiles : []) {
        const mode = profile?.['prompt-post-processing'];
        if (profile?.mode === 'cc' && upgrades[mode]) {
            profile['prompt-post-processing'] = upgrades[mode];
            changed = true;
        }
    }
    settings.gameToolsSetupVersion = 1;
    saveSettings();
    if (changed) {
        ctx.saveSettingsDebounced?.();
        log('Game tools: function calling turned on and prompt post-processing switched to the tool-keeping variants.');
    }
}

// A trade button writes the player's move into the message box; when it is
// sent the game system applies it, and the story narrates the result.
function openTradePanel() {
    if (!runtime.tradePanel) runtime.tradePanel = createTradePanel({ onAction: queuePanelAction });
    const store = getChatStore();
    runtime.tradePanel.refresh(store, displayScene(store), cleanString(context().name1, 100) || 'You');
    runtime.tradePanel.open();
}

function openWorldMap(view = 'world') {
    if (!runtime.mapPanel) runtime.mapPanel = createMapPanel({ onPerson: name => showEntityCard(name, 'details') });
    runtime.mapPanel.open(view);
    const userName = cleanString(context().name1, 100) || 'You';
    const render = attempt => {
        const store = getChatStore();
        runtime.mapPanel.refresh(store, displayScene(store), userName);
        if (!store && attempt < 6) setTimeout(() => render(attempt + 1), 1_000);
    };
    render(0);
}

// Rotating or unfolding the screen, switching theme, or the dock wrapping onto
// another line all move these edges without a new reply to redraw the dock.
function watchDockPlacement() {
    if (runtime.dockPlacementWatched) return;
    runtime.dockPlacementWatched = true;
    let frame = 0;
    const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(positionDock);
    };
    window.addEventListener('resize', schedule);
    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(schedule);
        for (const selector of ['#top-bar', '#top-settings-holder', '#il_cast_bar']) {
            const element = document.querySelector(selector);
            if (element) observer.observe(element);
        }
    }
}

function registerContextMacros() {
    const register = context().registerMacro;
    if (typeof register !== 'function') {
        console.warn(`${LOG_PREFIX} SillyTavern does not expose macro registration; automatic context injection remains available.`);
        return;
    }
    for (const macroName of Object.keys(INNERLORE_CONTEXT_MACROS)) {
        register(macroName, () => {
            const settings = context().extensionSettings?.[MODULE_KEY] || defaultSettings;
            const textMode = storyIsTextCompletion();
            let value = macroContextValue(macroName, {
                enabled: settings.enabled,
                deliveryMode: settings.contextDeliveryMode,
                prepared: textMode ? null : runtime.preparedContext,
                local: runtime.localContext,
                key: runtime.activeContextKey,
            });
            // The full-state macro also carries the SQLite-backed narrative
            // history so story context arrives from one plugin-owned source.
            // A text-completion story already carries the chat as its story.
            if (macroName === 'innerlore_state_context' && settings.enabled && value && !textMode) {
                const derived = runtime.derivedContext;
                if (derived) {
                    const historySettings = derived
                        ? { ...settings, historyBudgetCharacters: Math.min(40_000, Math.max(500, derived.historyCharacters)) }
                        : settings;
                    const history = buildHistorySection(historySettings);
                    if (history) value = `${value}\n${history}`;
                }
            }
            return value;
        }, 'Precomputed, branch-aware InnerLore SQLite context including the SQLite narrative history. No database work occurs during macro expansion.');
    }
}

function lastCompletedStoryIndex(messages, endIndex = messages.length - 1) {
    let index = Math.min(messages.length - 1, endIndex);
    while (index >= 0) {
        const message = messages[index];
        if (message
            && !message.is_user
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes)) return index;
        index--;
    }
    return -1;
}

function lastPlayerMessageIndex(messages, endIndex = messages.length - 1) {
    for (let index = Math.min(messages.length - 1, endIndex); index >= 0; index--) {
        const message = messages[index];
        if (message?.is_user && !message.is_system && cleanString(message.mes)) return index;
    }
    return -1;
}

function firstCompletedStoryIndex(messages, startIndex = 0, endIndex = messages.length - 1) {
    const finalIndex = Math.min(messages.length - 1, endIndex);
    for (let index = Math.max(0, startIndex); index <= finalIndex; index++) {
        const message = messages[index];
        if (message
            && !message.is_user
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes)) return index;
    }
    return -1;
}

function completedAssistantTurnCount(messages, startIndex = 0, endIndex = messages.length - 1) {
    const finalIndex = Math.min(messages.length - 1, endIndex);
    let count = 0;
    for (let index = Math.max(0, startIndex); index <= finalIndex; index++) {
        const message = messages[index];
        if (message
            && !message.is_user
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes)) count++;
    }
    return count;
}

/**
 * End a rebuild batch on a completed story reply. This keeps a player action
 * and the reply that resolves it in the same curator range even when the raw
 * numeric lookback boundary falls between them.
 */
function completedRebuildBatchEnd(messages, startIndex, targetIndex, maximumMessages) {
    const candidateEnd = Math.min(
        targetIndex,
        startIndex + Math.max(1, Number(maximumMessages) || 1) - 1,
    );
    const completedAtOrBeforeBoundary = lastCompletedStoryIndex(messages, candidateEnd);
    if (completedAtOrBeforeBoundary >= startIndex) return completedAtOrBeforeBoundary;
    return firstCompletedStoryIndex(messages, startIndex, targetIndex);
}

function boundedProgressionEnd(messages, startIndex, candidateEnd, maximumMessages, maximumCharacters = 85_000) {
    if (candidateEnd < startIndex) return -1;
    let characters = 0;
    let lastCompleted = -1;
    let relevantMessages = 0;
    const messageLimit = Math.max(2, maximumMessages);
    for (let index = startIndex; index <= candidateEnd; index++) {
        const message = messages[index];
        const relevant = message
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes);
        if (!relevant) continue;
        if (lastCompleted >= startIndex && relevantMessages >= messageLimit) break;
        const messageCharacters = cleanString(message?.mes, 30_000).length + 160;
        if (lastCompleted >= startIndex && characters + messageCharacters > maximumCharacters) break;
        relevantMessages++;
        characters += messageCharacters;
        if (message
            && !message.is_user
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes)) lastCompleted = index;
    }
    return lastCompleted;
}

function updateInjection({ isContinue = false } = {}) {
    const settings = getSettings();
    const store = getChatStore();
    const ctx = context();
    let injection = '';
    let contextDiagnostics = 'Context Compiler v2 is waiting for an active, fully processed chat.';
    let identityPlaceholders = [];
    let expressionCaseStressPermitted = false;
    let expressionCaseStressRequired = false;
    let expressionCharacterName = '';
    let expressionIdentityAnchor = '';
    let expressionVoiceAnchor = '';
    let expressionOuterVoiceAnchor = '';
    let expressionEmphasisAnchor = '';
    let expressionAnchorTerms = [];
    let expressionSurfaceCooldown = false;
    let compilation = null;
    const historyFallback = (store?.needsRebuild
        || !expressionFoundationReady(store))
        && runtime.historyFallbackStore
        && runtime.historyFallbackChatId === currentChatId()
        ? runtime.historyFallbackStore
        : null;
    const promptStore = historyFallback || store;
    if (settings.enabled && promptStore && (!store?.needsRebuild || historyFallback)) {
        const recentText = recentStoryText(Math.max(settings.loreRecencyMessages, settings.brainRecencyMessages));
        identityPlaceholders = findUnresolvedIdentityPlaceholders(promptStore.entities, recentText);
        const derivedSettings = { ...settings };
        {
            const cardFields = ctx.getCharacterCardFields?.() || {};
            const narratorTemplate = settings.narratorPromptEnabled === false
                ? ''
                : String(settings.narratorPromptTemplate || '');
            const staticPromptCharacters = narratorTemplate.replaceAll('{{innerlore_state_context}}', '').length
                + cleanString(cardFields.description, 200_000).length
                + cleanString(cardFields.personality, 200_000).length
                + cleanString(cardFields.scenario, 200_000).length
                + cleanString(cardFields.firstMessage, 200_000).length
                + cleanString(ctx.personaDescription, 200_000).length;
            const inputs = {
                contextLimitTokens: Number(ctx.maxContext) || 0,
                responseCapTokens: Number(runtime.responseCapTokens) || 0,
                staticPromptCharacters,
            };
            runtime.derivedContext = deriveContextBudgets(inputs, settings);
            runtime.derivedContextInputs = inputs;
            derivedSettings.derivedContext = runtime.derivedContext;
        }
        compilation = compileContext({
            store: promptStore,
            messages: ctx.chat,
            recentText,
            playerName: ctx.name1,
            currentIndex: ctx.chat.length - 1,
            turnActions: turnActionsForPrompt(),
            settings: {
                ...derivedSettings,
                currentIndex: ctx.chat.length - 1,
                recalledText: summaryceptionRecallText(ctx.chatMetadata),
                ...(historyFallback ? { worldProgressionEnabled: false } : {}),
            },
        });
        injection = compilation.text;
        expressionCaseStressPermitted = Boolean(compilation.expressionCaseStressPermitted);
        expressionCaseStressRequired = Boolean(compilation.expressionCaseStressRequired);
        expressionCharacterName = compilation.expressionCharacterName || '';
        expressionIdentityAnchor = compilation.expressionIdentityAnchor || '';
        expressionVoiceAnchor = compilation.expressionVoiceAnchor || '';
        expressionOuterVoiceAnchor = compilation.expressionOuterVoiceAnchor || '';
        expressionEmphasisAnchor = compilation.expressionEmphasisAnchor || '';
        expressionAnchorTerms = compilation.expressionAnchorTerms || [];
        expressionSurfaceCooldown = Boolean(compilation.expressionSurfaceCooldown);
        contextDiagnostics = historyFallback
            ? `Reswipe safety view through message ${runtime.historyFallbackBoundary - 1}; discarded-suffix state omitted until rebuild.\n\n${compilation.diagnostics}`
            : compilation.diagnostics;
    } else if (store?.needsRebuild) {
        contextDiagnostics = 'Context Compiler v2\nStale derived state is quarantined until the requested history rebuild completes.';
    }
    runtime.lastCompilation = compilation;
    runtime.activeContextKey = promptStore ? contextStateKey() : '';
    runtime.localContext = compilation
        ? createLocalContextPacket(compilation, runtime.activeContextKey)
        : null;
    // A text-completion story model (NovelAI's Erato or Kayra) reads lore
    // entries and an author's note, not the chat packet: the same compiled
    // facts in its own format, sized so the story keeps most of its context.
    const textMode = storyIsTextCompletion();
    let textMemory = '';
    if (textMode && compilation && runtime.localContext) {
        const textPacket = renderTextPacket({
            compilation,
            store: promptStore,
            playerName: ctx.name1,
            gameText: compilation.blocks?.game,
            budgetCharacters: textPacketBudget(ctx.maxContext),
        });
        // A story string without {{anchorAfter}} (a customised template)
        // never shows in-prompt extension prompts: the memory then rides
        // with the note.
        const anchored = String(ctx.powerUserSettings?.context?.story_string || '').includes('{{anchorAfter}}');
        textMemory = anchored ? textPacket.memory : '';
        const note = anchored ? textPacket.note : [textPacket.memory, textPacket.note].filter(Boolean).join('\n');
        runtime.localContext = { ...runtime.localContext, rendered: note, compact: note };
    }
    if (textMode) {
        // A NovelAI connection's story prompt leads the memory block.
        const shellConnection = typeof window !== 'undefined' ? window.InnerLoreShell?.activeConnection?.() : null;
        const lead = shellConnection?.mode === 'novel' ? cleanString(shellConnection.storyPrompt, 20_000).trim() : '';
        if (lead) textMemory = [lead, textMemory].filter(Boolean).join('\n\n');
    }
    if (textMemory !== (runtime.lastTextMemory || '')) {
        // 0 = in the prompt, right after the story string (NovelAI's memory).
        ctx.setExtensionPrompt(TEXT_MEMORY_PROMPT_KEY, textMemory, 0, 0, false, 0);
        if (textMemory) runtime.textMemoryHistory = [...(runtime.textMemoryHistory || []), textMemory].slice(-6);
        runtime.lastTextMemory = textMemory;
    }
    const contextPacket = textMode
        ? runtime.localContext
        : !historyFallback && !store?.needsRebuild
        ? selectedContextPacket({
            prepared: runtime.preparedContext,
            local: runtime.localContext,
            key: runtime.activeContextKey,
        })
        : runtime.localContext;
    const deliveryMode = settings.contextDeliveryMode === 'macro' ? 'macro' : 'automatic';
    runtime.deliveredPacketText = contextPacket?.rendered || injection || '';
    // The prompt holds whichever version was current when SillyTavern built it.
    if (runtime.deliveredPacketText && runtime.deliveredPacketHistory?.at(-1) !== runtime.deliveredPacketText) {
        runtime.deliveredPacketHistory = [...(runtime.deliveredPacketHistory || []), runtime.deliveredPacketText].slice(-6);
    }
    injection = deliveryMode === 'macro' ? '' : (contextPacket?.rendered || injection);
    const preparedStatus = contextPacket?.source === 'server'
        ? `Prepared SQLite state: revision ${contextPacket.revision ?? runtime.storageRevision}${contextPacket.cache?.status ? ` (${contextPacket.cache.status})` : ''}.`
        : 'Prepared SQLite state: local deterministic fallback is active.';
    contextDiagnostics = `${preparedStatus}${runtime.contextPreparationError ? `\nLast server preparation error: ${runtime.contextPreparationError}` : ''}\nDelivery: ${deliveryMode === 'macro' ? '{{innerlore_state_context}} macro' : 'automatic near-turn system prompt'}.\n\n${contextDiagnostics}`;
    runtime.lastContextDiagnostics = contextDiagnostics;
    if (injection !== runtime.lastInjection) {
        // 1 = in-chat, role 0 = system. Keeping the block near the latest turn
        // makes it harder for long context to wash out private state and canon.
        ctx.setExtensionPrompt(PROMPT_KEY, injection, 1, Number(settings.injectionDepth) || 0, false, 0);
        runtime.lastInjection = injection;
        log('Prompt injection updated:', injection.length, 'characters');
    }
    // The HUD reflects the compiled scene and store whether or not the
    // packet text itself changed; refresh it on every injection build. The
    // displayed location resolves to canonical entities.
    if (compilation?.scene) {
        compilation.scene = resolveSceneLocationForDisplay(compilation.scene);
    }
    updateCastCards();
    // A continue extends an already-written reply. The latest-turn contract is
    // a "produce THIS reply" directive full of mandatory-outcome and required-
    // expression gates that the existing text already satisfies, so injecting
    // it makes the model emit an immediate stop and append nothing. Suppress it
    // for continuations; the next fresh turn rebuilds it.
    // A prose model cannot follow the chat contract; the text note carries its one line.
    let turnContract = settings.enabled && !isContinue && !textMode
        ? buildLatestTurnContract(ctx.chat, {
            identityPlaceholders,
            playerName: ctx.name1,
            expressionCaseStressPermitted,
            expressionCaseStressRequired,
            expressionCharacterName,
            expressionIdentityAnchor,
            expressionVoiceAnchor,
            expressionOuterVoiceAnchor,
            expressionEmphasisAnchor,
            expressionAnchorTerms,
            expressionSurfaceCooldown,
            guidedPlay: settings.guidedPlayEnabled !== false,
        })
        : '';
    // NovelAI's chat models (Xialong, GLM) keep facts best when they sit
    // beside the newest turn: the game lines are repeated at the end.
    // The same holds for Featherless's models; they also get a cast lock.
    const limitedStory = !textMode && isLimitedProvider(storyProvider());
    const gameFacts = limitedStory
        ? String(compilation?.blocks?.game || '').replace(/<\/?inner_lore_game_state[^>]*>/gu, '').split('\n')
            .filter(line => line.trim() && !line.startsWith('This is the game ledger')).join('\n')
        : '';
    if (turnContract && limitedStory) {
        const player = cleanString(ctx.name1, 100) || 'the player';
        const castLock = buildCastLock((compilation?.scene?.participants || []).map(person => person?.name), ctx.name1);
        turnContract = `${turnContract}${gameFacts ? `\nFacts for this reply (keep every price, coin and person exactly as given here):\n${gameFacts}` : ''}\n${castLock}\nWrite only the world's response to ${player}'s command: never ${player}'s own words, thoughts or further actions.`;
    }
    if (turnContract !== runtime.lastTurnContract) {
        // Keep literal instructions from the newest user beside the generation
        // boundary. This prevents a long history from reviving superseded
        // assistant suggestions without hard-coding any scenario canon.
        ctx.setExtensionPrompt(TURN_CONTRACT_PROMPT_KEY, turnContract, 1, 0, false, 0);
        runtime.lastTurnContract = turnContract;
        log('Latest-turn contract updated:', turnContract.length, 'characters');
    }
    const preview = document.getElementById('il_injection_preview');
    if (preview) preview.value = contextPacket?.rendered || injection;
    const diagnostics = document.getElementById('il_context_diagnostics');
    if (diagnostics) diagnostics.value = contextDiagnostics;
    return injection;
}

function updateTriggerDeliveryPrompt({
    storyGeneration = true,
    isContinue = false,
    recordInjection = false,
    attemptMessageIndex,
} = {}) {
    const settings = getSettings();
    const store = getChatStore();
    const ctx = context();
    let prompt = '';
    let compilation = { text: '', records: [], deliveries: [], previewSeconds: 0 };
    // A continuation extends an existing reply and must not be handed a fresh
    // "reveal this editor event now" mandate, which would inject new turn
    // content instead of continuing. Suppress it for continues.
    if (storyGeneration
        && !isContinue
        && settings.enabled
        && settings.worldProgressionEnabled
        && store
        && !store.needsRebuild) {
        const progression = normalizeProgressionState(store.progression);
        compilation = compileTriggerEventDeliveryPreview(
            progression,
            ctx.chat,
            {
                currentIndex: ctx.chat.length - 1,
                attemptMessageIndex,
                playerName: ctx.name1,
                maximumAttemptPreviews: settings.triggerAttemptPreviewMaximum,
                generationId: runtime.activeStoryGenerationId,
            },
        );
        prompt = compilation.text;
        if (recordInjection && prompt && compilation.deliveries.length) {
            const marked = markTriggerEventDeliveriesInjected(progression, compilation.deliveries, {
                messageIndex: ctx.chat.length - 1,
                generationId: runtime.activeStoryGenerationId,
                prompt,
            });
            store.progression = marked.state;
            if (marked.changed) {
                void saveChatStore().catch(error => {
                    console.error(`${LOG_PREFIX} Could not persist trigger-event delivery attempt:`, error);
                });
            }
        }
    }
    if (prompt !== runtime.lastTriggerDeliveryPrompt) {
        // This near-turn system block is intentionally separate from the
        // budgeted continuity injection: an observable editor event must not
        // be crowded out by other goals, processes, or lore entries.
        ctx.setExtensionPrompt(TRIGGER_DELIVERY_PROMPT_KEY, prompt, 1, 0, false, 0);
        runtime.lastTriggerDeliveryPrompt = prompt;
        log('Trigger-event delivery prompt updated:', prompt.length, 'characters');
    }
    return prompt;
}

function parseCommaList(value) {
    return uniqueStrings(String(value || '').split(',').map(item => item.trim()), 40);
}

function populateProfiles() {
    const settings = getSettings();
    const select = document.getElementById('il_connection_profile');
    const fallbackSelect = document.getElementById('il_fallback_connection_profile');
    const progressionSelect = document.getElementById('il_progression_profile');
    const progressionFallbackSelect = document.getElementById('il_progression_fallback_profile');
    if (!select && !fallbackSelect && !progressionSelect && !progressionFallbackSelect) return;
    const profiles = listConnectionProfiles();
    settings.connectionProfileId = chooseDefaultProfileId(settings.connectionProfileId);
    settings.progressionConnectionProfileId = chooseDefaultProfileId(
        settings.progressionConnectionProfileId || settings.connectionProfileId,
    );
    for (const [element, selectedId] of [
        [select, settings.connectionProfileId],
        [progressionSelect, settings.progressionConnectionProfileId],
    ]) {
        if (!element) continue;
        element.replaceChildren();
        for (const profile of profiles) {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = `${profile.name}${profile.model ? ` — ${profile.model}` : ''}`;
            element.append(option);
        }
        if (!profiles.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No supported profiles found';
            element.append(option);
        }
        element.value = selectedId;
    }
    for (const [element, selectedId, sameLabel] of [
        [document.getElementById('il_game_profile'), settings.gameConnectionProfileId, 'Same as the curator profile'],
        [document.getElementById('il_planner_profile'), settings.plannerConnectionProfileId, 'Same as the progression profile'],
        [document.getElementById('il_minds_profile'), settings.mindsConnectionProfileId, 'Same request as the curator'],
    ]) {
        if (!element) continue;
        element.replaceChildren();
        const same = document.createElement('option');
        same.value = '';
        same.textContent = sameLabel;
        element.append(same);
        for (const profile of profiles) {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = `${profile.name}${profile.model ? ` — ${profile.model}` : ''}`;
            element.append(option);
        }
        element.value = profiles.some(profile => profile.id === selectedId) ? selectedId : '';
    }
    for (const [element, selectedId] of [
        [fallbackSelect, settings.fallbackConnectionProfileId],
        [progressionFallbackSelect, settings.progressionFallbackConnectionProfileId],
    ]) {
        if (!element) continue;
        element.replaceChildren();
        const disabled = document.createElement('option');
        disabled.value = '';
        disabled.textContent = 'No fallback';
        element.append(disabled);
        for (const profile of profiles) {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = `${profile.name}${profile.model ? ` — ${profile.model}` : ''}`;
            element.append(option);
        }
        element.value = profiles.some(profile => profile.id === selectedId) ? selectedId : '';
    }
    saveSettings();
}

function populateContextProfiles() {
    const select = document.getElementById('il_context_profile');
    if (!select) return;
    const settings = getSettings();
    const profiles = runtime.contextProfiles.length
        ? runtime.contextProfiles
        : Object.entries(BUILTIN_CONTEXT_PROFILES).map(([id, config]) => ({
            id, name: `${id[0].toUpperCase()}${id.slice(1)}`, builtin: true, config,
        }));
    select.replaceChildren();
    for (const profile of profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = `${profile.name || profile.id}${profile.builtin ? '' : ' — custom server profile'}`;
        select.append(option);
    }
    if (!profiles.some(profile => profile.id === settings.contextProfileId)) {
        const option = document.createElement('option');
        option.value = settings.contextProfileId;
        option.textContent = `${settings.contextProfileId} — unavailable`;
        select.append(option);
    }
    select.value = settings.contextProfileId;
}

function updateContextBudgetUI() {
    const settings = getSettings();
    const value = document.getElementById('il_context_maximum_value');
    const context = runtime.derivedContext;
    const shares = settings.derivedSectionShares || DERIVED_SHARE_DEFAULTS;
    const shareText = `response ${shares.response}% · history ${shares.history}% · scene ${shares.scene}% · minds ${shares.minds}% · lore ${shares.lore}% · progression ${shares.progression}% · game ${shares.game ?? DERIVED_SHARE_DEFAULTS.game}%`;
    if (value) {
        value.textContent = context
            ? `Derived (always on) · packet ${Number(context.maximumCharacters).toLocaleString()} ch (~${approximateContextTokens(context.maximumCharacters).toLocaleString()} tok)`
                + ` · history ${Number(context.historyCharacters).toLocaleString()} ch · response ${Number(context.responseTokens).toLocaleString()} tok`
                + ` · fixed costs ${Number(context.staticTokens).toLocaleString()} tok · shares of ${Number(context.grossTokens).toLocaleString()} tok`
            : `Derived (always on) · ${shareText} · waiting for the next story generation to measure fixed costs`;
    }
}

async function refreshContextProfiles({ synchronizeSettings = true } = {}) {
    if (!runtime.storageReady || !runtime.storageWorldId) return runtime.contextProfiles;
    try {
        const profiles = await activeStorageClient().contextProfiles(runtime.storageWorldId);
        if (Array.isArray(profiles) && profiles.length) runtime.contextProfiles = profiles;
        const settings = getSettings();
        const selected = runtime.contextProfiles.find(profile => profile.id === settings.contextProfileId);
        if (synchronizeSettings && settings.contextBudgetMode === 'profile' && selected) {
            applyContextProfileToSettings(settings, selected);
            saveSettings();
        }
        populateContextProfiles();
        updateContextBudgetUI();
        return runtime.contextProfiles;
    } catch (error) {
        log('Could not refresh server context profiles:', error?.message || error);
        populateContextProfiles();
        updateContextBudgetUI();
        return runtime.contextProfiles;
    }
}

function refreshContextAfterConfigurationChange() {
    runtime.contextPreparation?.controller?.abort();
    runtime.contextPreparation = null;
    runtime.preparedContext = null;
    runtime.contextPreparationError = '';
    runtime.lastInjection = '';
    updateContextBudgetUI();
    updateInjection();
    void prepareServerContext({ force: true });
}

function makeContextConfigurationCustom() {
    markContextConfigurationCustom(getSettings());
    saveSettings();
    refreshContextAfterConfigurationChange();
}

function setInputValue(id, value) {
    const element = document.getElementById(id);
    if (!element) return;
    if (element.type === 'checkbox') element.checked = Boolean(value);
    else element.value = value ?? '';
}

function applySettingsToUI() {
    const versionLabel = document.getElementById('il_version_label');
    if (versionLabel) versionLabel.textContent = `v${EXTENSION_VERSION}`;
    const settings = getSettings();
    const fields = {
        il_enabled: settings.enabled,
        il_storage_backend: settings.storageBackend,
        il_auto_update: settings.autoUpdate,
        il_auto_recover_incomplete: settings.autoRecoverIncomplete,
        il_incomplete_recovery_attempts: settings.incompleteRecoveryAttempts,
        il_inner_self_enabled: settings.innerSelfEnabled,
        il_auto_lore_enabled: settings.autoLoreEnabled,
        il_connection_source: settings.connectionSource,
        il_connection_profile: settings.connectionProfileId,
        il_fallback_connection_profile: settings.fallbackConnectionProfileId,
        il_provider_concurrency: String(settings.providerConcurrency),
        il_maximum_response_tokens: settings.maximumResponseTokens,
        il_temperature: settings.temperature,
        il_request_timeout: settings.requestTimeoutSeconds,
        il_maintenance_output_format: settings.maintenanceOutputFormat,
        il_repair_json: settings.repairMalformedJson,
        il_process_every: settings.processEveryAssistantTurns,
        il_adaptive_maintenance: settings.adaptiveMaintenanceEnabled,
        il_minimum_adaptive_batch: settings.minimumAdaptiveBatchTurns,
        il_lookback_messages: settings.lookbackMessages,
        il_max_entities_per_pass: settings.maximumEntitiesPerPass,
        il_max_minds_per_pass: settings.maximumMindOperationsPerPass,
        il_minimum_importance: settings.minimumImportance,
        il_card_detail: settings.cardDetail,
        il_auto_rebuild_history: settings.autoRebuildOnHistoryChange,
        il_auto_rebuild_limit: settings.autoRebuildMessageLimit,
        il_maximum_thoughts: settings.maximumThoughtsPerBrain,
        il_maximum_thought_changes: settings.maximumThoughtChangesPerBrain,
        il_minimum_story_facet_observations: settings.minimumStoryFacetObservations,
        il_brain_consolidation_similarity: settings.brainConsolidationSimilarity,
        il_maximum_scene_thoughts: settings.maximumSceneThoughtsPerBrain,
        il_maximum_active_brains: settings.maximumActiveBrains,
        il_maximum_injected_thoughts: settings.maximumInjectedThoughtsPerBrain,
        il_scene_thought_age: settings.maximumSceneThoughtAge,
        il_brain_budget: settings.brainInjectionBudget,
        il_lore_budget: settings.loreInjectionBudget,
        il_maximum_injected_entities: settings.maximumInjectedEntities,
        il_scene_lookback: settings.sceneLookbackMessages,
        il_scene_budget: settings.sceneInjectionBudget,
        il_injection_depth: settings.injectionDepth,
        il_context_delivery_mode: settings.contextDeliveryMode,
        il_context_profile: settings.contextProfileId,
        il_context_maximum: settings.contextMaximumCharacters,
        il_server_context_timeout: settings.serverContextTimeoutMs,
        il_custom_instructions: settings.customInstructions,
        il_story_provider_body: settings.storyProviderBody,
        il_world_progression_enabled: settings.worldProgressionEnabled,
        il_progression_every: settings.progressionEveryAssistantTurns,
        il_progression_autonomy: settings.progressionAutonomy,
        il_progression_time_mode: settings.progressionTimeMode,
        il_progression_profile: settings.progressionConnectionProfileId,
        il_progression_fallback_profile: settings.progressionFallbackConnectionProfileId,
        il_progression_maximum_response_tokens: settings.progressionMaximumResponseTokens,
        il_progression_temperature: settings.progressionTemperature,
        il_progression_request_timeout: settings.progressionRequestTimeoutSeconds,
        il_progression_maximum_goals: settings.progressionMaximumGoals,
        il_progression_maximum_processes: settings.progressionMaximumProcesses,
        il_progression_maximum_events: settings.progressionMaximumEvents,
        il_progression_maximum_injected: settings.progressionMaximumInjectedEntries,
        il_progression_injection_budget: settings.progressionInjectionBudget,
        il_progression_rebuild_batch: settings.progressionRebuildBatchMessages,
        il_trigger_delivery_attempts: settings.triggerDeliveryMaximumAttempts,
        il_trigger_attempt_previews: settings.triggerAttemptPreviewMaximum,
        il_progression_custom_instructions: settings.progressionCustomInstructions,
        il_event_director_enabled: settings.automaticEventDirectorEnabled,
        il_event_director_mode: settings.automaticEventDirectorMode,
        il_event_director_activity: settings.automaticEventDirectorActivity,
        il_event_director_confidence: settings.automaticEventDirectorMinimumConfidence,
        il_event_director_expiration: settings.automaticEventDirectorExpirationTurns,
        il_event_director_private_minds: settings.automaticEventDirectorIncludePrivateMinds,
        il_narrator_prompt_enabled: settings.narratorPromptEnabled,
        il_narrator_prompt: settings.narratorPromptTemplate,
        il_history_in_macro: settings.historyInMacroEnabled,
        il_history_budget: settings.historyBudgetCharacters,
        il_history_max_turns: settings.historyMaxTurns,
        il_context_budget_mode: settings.contextBudgetMode,
        il_derived_margin: settings.derivedSafetyMarginPercent,
        il_derived_share_response: (settings.derivedSectionShares || {}).response,
        il_derived_share_history: (settings.derivedSectionShares || {}).history,
        il_derived_share_scene: (settings.derivedSectionShares || {}).scene,
        il_derived_share_minds: (settings.derivedSectionShares || {}).minds,
        il_derived_share_lore: (settings.derivedSectionShares || {}).lore,
        il_derived_share_progression: (settings.derivedSectionShares || {}).progression,
        il_derived_share_game: (settings.derivedSectionShares || {}).game,
        il_narration_length: settings.narrationLength,
        il_guided_play: settings.guidedPlayEnabled !== false,
        il_debug: settings.debug,
        il_parallel_passes: settings.parallelBackgroundPasses === true,
        il_game_enabled: settings.gameEnabled !== false,
        il_game_ledger_enabled: settings.gameLedgerEnabled !== false,
        il_scene_planner_enabled: settings.scenePlannerEnabled !== false,
        il_scene_planner_prefetch: settings.scenePlannerPrefetch !== false,
        il_story_preempts_background: settings.storyPreemptsBackground !== false,
        il_scene_planner_at_send: settings.scenePlannerAtSend !== false,
        il_scene_planner_wait: settings.scenePlannerSendWaitSeconds,
        il_scene_planner_places: settings.scenePlannerMaximumPlaces,
        il_scene_planner_stale_hours: settings.scenePlannerStaleHours,
        il_game_injection_budget: settings.gameInjectionBudget,
        il_game_custom_instructions: settings.gameCustomInstructions,
        il_planner_custom_instructions: settings.plannerCustomInstructions,
        il_assisted_background: settings.assistedBackground || 'auto',
        il_cast_cards: settings.castCardsEnabled !== false,
        il_portraits_enabled: settings.portraitsEnabled !== false,
        il_game_tools: settings.gameToolsEnabled !== false,
        il_voice_enabled: settings.voiceEnabled !== false,
        il_voice_autoplay: settings.voiceAutoPlay !== false,
        il_voice_dialogue: settings.voiceDialogue !== false,
        il_voice_narration: settings.voiceNarration !== false,
        il_voice_speed: settings.voiceSpeed ?? 1,
        il_voice_url: settings.voiceServerUrl || '',
        il_voice_streaming: settings.voiceStreaming !== false,
        il_voice_skip_tags: settings.voiceSkipTags !== false,
        il_voice_gap: settings.voiceGapMs ?? 140,
        il_voice_emotion: settings.voiceEmotion ?? 1,
        il_voice_child_pitch: settings.voiceChildPitch ?? 3,
        il_voice_steps: settings.voiceSteps ?? 0,
        il_voice_silence: settings.voiceSilence ?? 0,
        il_voice_takes: settings.voiceTakes ?? 1,
        il_voice_italics: settings.voiceItalics || 'thought',
        il_voice_tags: settings.voiceTags !== false,
        il_voice_live: settings.voiceLive === true,
        il_voice_input_enabled: settings.voiceInputEnabled !== false,
        il_voice_input_provider: settings.voiceInputProvider || 'local',
        il_voice_input_mode: settings.voiceInputMode || 'box',
        il_voice_input_language: settings.voiceInputLanguage || 'en-US',
        il_portrait_url: settings.portraitServerUrl,
        il_portrait_style: settings.portraitStyle,
        il_portrait_negative: settings.portraitNegative,
        il_portrait_steps: settings.portraitSteps,
        il_portrait_cfg: settings.portraitCfg,
    };
    for (const [id, value] of Object.entries(fields)) setInputValue(id, value);
    document.querySelectorAll('#il_entity_types input[type="checkbox"]').forEach(input => {
        input.checked = settings.enabledEntityTypes.includes(input.value);
    });
    document.getElementById('il_profile_row')?.classList.toggle('displayNone', settings.connectionSource !== 'profile');
    populateContextProfiles();
    updateContextBudgetUI();
}

function renderEntityEditor() {
    const store = getChatStore();
    const record = store?.entities?.[runtime.selectedEntityId];
    const editor = document.getElementById('il_entity_editor');
    if (!editor) return;
    editor.classList.toggle('is-empty', !record);
    if (!record) return;
    setInputValue('il_entity_aliases', (record.aliases || []).join(', '));
    setInputValue('il_entity_keys', (record.keys || []).join(', '));
    setInputValue('il_entity_importance', record.importance);
    setInputValue('il_entity_enabled', record.enabled !== false);
    setInputValue('il_entity_pinned', record.pinned);
    setInputValue('il_entity_content', renderLoreContent(record));
}

function brainEditorJson(brain) {
    const compactEntries = entries => Object.fromEntries(Object.values(entries || {}).map(entry => [entry.key, {
        kind: entry.kind,
        statement: entry.statement,
        confidence: entry.confidence,
    }]));
    const result = {
        persistent_self: compactEntries(brain?.persistentSelf?.facets),
        voice: compactEntries(brain?.persistentSelf?.voice),
        relationships: Object.fromEntries(Object.values(brain?.persistentSelf?.relationships || {}).map(relationship => [
            relationship.target,
            {
                aliases: relationship.aliases || [],
                aspects: compactEntries(relationship.aspects),
            },
        ])),
        current_mind: brain?.currentMind || null,
    };
    return JSON.stringify(result, null, 2);
}

function renderBrainEditor() {
    const store = getChatStore();
    const brain = store?.brains?.[runtime.selectedBrainId];
    const editor = document.getElementById('il_brain_editor');
    if (!editor) return;
    editor.classList.toggle('is-empty', !brain);
    if (!brain) {
        const visual = document.getElementById('il_brain_visual');
        if (visual) visual.replaceChildren();
        setInputValue('il_brain_aliases', '');
        setInputValue('il_brain_enabled', true);
        setInputValue('il_brain_pinned', false);
        setInputValue('il_brain_json', '');
        runtime.brainJsonDirty = false;
        updateBrainViewPanes();
        return;
    }
    setInputValue('il_brain_aliases', (brain.aliases || []).join(', '));
    setInputValue('il_brain_enabled', brain.enabled !== false);
    setInputValue('il_brain_pinned', brain.pinned);
    if (!runtime.brainJsonDirty) setInputValue('il_brain_json', brainEditorJson(brain));
    renderBrainVisual(brain);
    updateBrainViewPanes();
}

function brainViewElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== '') element.textContent = text;
    return element;
}

function brainFacetRow(entry, toneHint) {
    const row = brainViewElement('div', 'il-mv-facet');
    const head = brainViewElement('span', 'il-mv-facet-head');
    head.append(brainKindBadge(entry.kind, toneHint));
    head.append(brainConfidenceDot(entry.confidence, entry.observations));
    row.append(head);
    const statement = brainViewElement('span', 'il-mv-facet-statement', entry.statement);
    statement.title = entry.key ? `Key: ${entry.key}` : '';
    row.append(statement);
    return row;
}

function brainKindBadge(kind, toneHint) {
    const badge = brainViewElement('span', `il-mv-kind tone-${brainKindTone(kind, toneHint)}`, brainKindLabel(kind));
    badge.title = `${kind} · ${toneHint}`;
    return badge;
}

function brainConfidenceDot(confidence, observations) {
    const dot = brainViewElement('span', `il-mv-confidence ${confidence === 'confirmed' ? 'is-confirmed' : 'is-inferred'}`);
    const count = Math.max(1, Number(observations) || 1);
    dot.title = `${confidence === 'confirmed' ? 'Confirmed' : 'Inferred'} · observed ${count} time${count === 1 ? '' : 's'}`;
    return dot;
}

function brainKindTone(kind, toneHint) {
    const tone = FACET_TONE_BY_KIND[String(kind || '')];
    if (tone) return tone;
    return toneHint === 'voice' ? 'voice' : toneHint === 'relationship' ? 'relation' : 'mind';
}

function brainKindLabel(kind) {
    return String(kind || 'note').replace(/_/g, ' ');
}

function brainRelativeTime(timestamp) {
    const elapsed = Date.now() - (Math.max(0, Number(timestamp)) || 0);
    if (!Number.isFinite(elapsed) || elapsed < 0) return '';
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'moments ago';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

function brainEmotionChip(emotion) {
    const intensity = EMOTIONAL_INTENSITY_CLASS[emotion.intensity] || 'int-moderate';
    const chip = brainViewElement('span', `il-mv-emotion ${intensity}`, emotion.name);
    chip.title = emotion.cause
        ? `${emotion.intensity} intensity — ${emotion.cause}`
        : `${emotion.intensity} intensity`;
    return chip;
}

const FACET_TONE_BY_KIND = Object.freeze({
    personal_anchor: 'identity',
    self_concept: 'identity',
    trait: 'identity',
    value: 'identity',
    fear: 'emotion',
    insecurity: 'emotion',
    desire: 'emotion',
    emotional_need: 'emotion',
    contradiction: 'emotion',
    bias: 'emotion',
    worldview: 'mind',
    belief: 'mind',
    opinion: 'mind',
    goal: 'agency',
    plan: 'agency',
    behavioral_tendency: 'agency',
    secret: 'hidden',
    memory: 'memory',
    relationship_stance: 'memory',
});

const EMOTIONAL_INTENSITY_CLASS = Object.freeze({
    low: 'int-low',
    moderate: 'int-moderate',
    high: 'int-high',
    overwhelming: 'int-overwhelming',
});

/** Themed buckets for Persistent Self facets, rendered in this order. */
const FACET_GROUPS = Object.freeze([
    { id: 'identity', title: 'Identity', icon: 'fa-fingerprint', kinds: ['personal_anchor', 'self_concept', 'trait', 'value'] },
    { id: 'inner_life', title: 'Inner Life', icon: 'fa-heart-crack', kinds: ['fear', 'insecurity', 'desire', 'emotional_need', 'contradiction', 'bias'] },
    { id: 'beliefs', title: 'Beliefs & Outlook', icon: 'fa-compass', kinds: ['worldview', 'belief', 'opinion'] },
    { id: 'wants', title: 'Wants & Plans', icon: 'fa-bullseye', kinds: ['goal', 'plan', 'behavioral_tendency'] },
    { id: 'private', title: 'Memory & Private', icon: 'fa-lock', kinds: ['memory', 'secret', 'relationship_stance'] },
]);

let brainGroupCollapseState = null;

function brainGroupCollapseMap() {
    if (!brainGroupCollapseState) {
        try {
            brainGroupCollapseState = JSON.parse(localStorage.getItem('InnerLore_BrainGroups') || '{}');
        } catch {
            brainGroupCollapseState = {};
        }
        if (!brainGroupCollapseState || typeof brainGroupCollapseState !== 'object') brainGroupCollapseState = {};
    }
    return brainGroupCollapseState;
}

function brainCurrentMindBand(label, children) {
    if (!children.length) return null;
    const band = brainViewElement('div', 'il-mv-band');
    band.append(brainViewElement('div', 'il-mv-section-label', label));
    for (const child of children) band.append(child);
    return band;
}

function brainCurrentMindCard(currentMind) {
    const card = brainViewElement('div', 'il-mv-card il-mv-current');
    const header = brainViewElement('div', 'il-mv-card-header');
    header.append(brainViewElement('i', 'fa-solid fa-heart-pulse il-mv-card-icon'));
    header.append(brainViewElement('b', '', 'Current Mind'));
    const freshness = [
        Number.isInteger(currentMind.sourceMessage) && currentMind.sourceMessage >= 0
            ? `from message ${currentMind.sourceMessage + 1}`
            : '',
        brainRelativeTime(currentMind.updatedAt),
    ].filter(Boolean).join(' · ');
    if (freshness) header.append(brainViewElement('span', 'il-mv-freshness il-mv-card-meta', freshness));
    card.append(header);

    const chips = brainViewElement('div', 'il-mv-chip-row');
    for (const emotion of currentMind.emotions || []) chips.append(brainEmotionChip(emotion));
    const feelingBand = brainCurrentMindBand('Feeling right now', chips.childElementCount ? [chips] : []);
    if (feelingBand) card.append(feelingBand);

    const thoughtQuotes = (currentMind.innerThoughts || []).map(thought => brainViewElement('div', 'il-mv-quote', thought));
    const thinkingBand = brainCurrentMindBand('Thinking', thoughtQuotes);
    if (thinkingBand) card.append(thinkingBand);

    const readingFields = [
        ['perception', 'Perceives'],
        ['interpretation', 'Interprets'],
        ['attention', 'Attention on'],
    ];
    const readingRows = [];
    for (const [field, label] of readingFields) {
        const value = String(currentMind[field] || '').trim();
        if (!value) continue;
        const row = brainViewElement('div', 'il-mv-field');
        row.append(brainViewElement('span', 'il-mv-field-label', label));
        row.append(brainViewElement('span', 'il-mv-field-value', value));
        readingRows.push(row);
    }
    const readingBand = brainCurrentMindBand('Reading the moment', readingRows);
    if (readingBand) card.append(readingBand);

    const headingFields = [
        ['expectation', 'Expects'],
        ['immediateGoal', 'Immediate goal'],
        ['impulse', 'Impulse'],
        ['restraint', 'Restraint'],
        ['conflict', 'Inner conflict'],
        ['intention', 'Intends'],
    ];
    const headingRows = [];
    for (const [field, label] of headingFields) {
        const value = String(currentMind[field] || '').trim();
        if (!value) continue;
        const row = brainViewElement('div', 'il-mv-field');
        row.append(brainViewElement('span', 'il-mv-field-label', label));
        row.append(brainViewElement('span', 'il-mv-field-value', value));
        headingRows.push(row);
    }
    const headingBand = brainCurrentMindBand("Where it's heading", headingRows);
    if (headingBand) card.append(headingBand);
    return card;
}

function brainCollapsibleCard({ id, icon, title, count, body }) {
    const card = brainViewElement('div', 'il-mv-card il-mv-collapsible');
    if (id) {
        card.dataset.group = id;
        if (brainGroupCollapseMap()[id]) card.classList.add('is-collapsed');
    }
    const header = brainViewElement('button', 'il-mv-card-header il-mv-card-toggle');
    header.type = 'button';
    header.setAttribute('aria-expanded', card.classList.contains('is-collapsed') ? 'false' : 'true');
    header.append(brainViewElement('i', `fa-solid ${icon} il-mv-card-icon`));
    header.append(brainViewElement('b', '', title));
    if (count !== null && count !== undefined) {
        header.append(brainViewElement('span', 'il-mv-count il-mv-card-meta', String(count)));
    }
    header.append(brainViewElement('i', 'fa-solid fa-chevron-down il-mv-chevron'));
    card.append(header);
    const bodyElement = brainViewElement('div', 'il-mv-card-body');
    for (const child of body) bodyElement.append(child);
    card.append(bodyElement);
    return card;
}

function brainFacetGroupCard(group, entries) {
    const list = Object.values(entries || {})
        .filter(entry => group.kinds.includes(String(entry.kind)))
        .sort((a, b) => ((b.confidence === 'confirmed') - (a.confidence === 'confirmed'))
            || String(a.key || '').localeCompare(String(b.key || '')));
    if (!list.length) return null;
    return brainCollapsibleCard({
        id: group.id,
        icon: group.icon,
        title: group.title,
        count: list.length,
        body: list.map(entry => brainFacetRow(entry, 'self')),
    });
}

function brainVoiceCard(entries) {
    const list = Object.values(entries || {});
    if (!list.length) return null;
    return brainCollapsibleCard({
        id: 'voice',
        icon: 'fa-comment-dots',
        title: 'Voice',
        count: list.length,
        body: list.map(entry => brainFacetRow(entry, 'voice')),
    });
}

function brainRelationshipCard(relationships) {
    const list = Object.values(relationships || {});
    if (!list.length) return null;
    const blocks = [];
    for (const relationship of list) {
        const block = brainViewElement('div', 'il-mv-relationship');
        const nameRow = brainViewElement('div', 'il-mv-relationship-name');
        nameRow.append(brainViewElement('span', '', relationship.target));
        if ((relationship.aliases || []).length) {
            nameRow.append(brainViewElement('span', 'il-mv-alias', `aka ${relationship.aliases.join(', ')}`));
        }
        block.append(nameRow);
        const aspects = Object.values(relationship.aspects || {})
            .sort((a, b) => ((b.confidence === 'confirmed') - (a.confidence === 'confirmed'))
                || String(a.key || '').localeCompare(String(b.key || '')));
        for (const aspect of aspects) block.append(brainFacetRow(aspect, 'relationship'));
        blocks.push(block);
    }
    return brainCollapsibleCard({
        id: 'relationships',
        icon: 'fa-people-arrows',
        title: 'Relationships',
        count: list.length,
        body: blocks,
    });
}

function renderBrainVisual(brain) {
    const visual = document.getElementById('il_brain_visual');
    if (!visual) return;
    visual.replaceChildren();

    if (brain.enabled === false) {
        visual.append(brainViewElement('div', 'il-mv-disabled-note', 'This mind is disabled — it will not be analyzed or injected.'));
    }

    const persistentSelf = brain?.persistentSelf || {};
    const facetCount = Object.keys(persistentSelf.facets || {}).length;
    const voiceCount = Object.keys(persistentSelf.voice || {}).length;
    const relationshipCount = Object.keys(persistentSelf.relationships || {}).length;
    const summary = [
        `${facetCount} trait${facetCount === 1 ? '' : 's'}`,
        `${voiceCount} voice habit${voiceCount === 1 ? '' : 's'}`,
        `${relationshipCount} relationship${relationshipCount === 1 ? '' : 's'}`,
        brain?.currentMind ? 'live snapshot' : 'no snapshot yet',
    ].join(' · ');
    visual.append(brainViewElement('div', 'il-mv-summary', summary));

    if (brain?.currentMind) {
        visual.append(brainCurrentMindCard(brain.currentMind));
    } else {
        visual.append(brainViewElement('div', 'il-mv-empty',
            'No current-mind snapshot yet. It appears after the next background analysis of this chat.'));
    }

    const groupedKinds = new Set(FACET_GROUPS.flatMap(group => group.kinds));
    const leftovers = Object.values(persistentSelf.facets || {})
        .filter(entry => !groupedKinds.has(String(entry.kind)));
    const sections = [
        ...FACET_GROUPS.map(group => brainFacetGroupCard(group, persistentSelf.facets)),
        leftovers.length ? brainCollapsibleCard({
            id: 'other',
            icon: 'fa-circle-question',
            title: 'Other Records',
            count: leftovers.length,
            body: leftovers.map(entry => brainFacetRow(entry, 'self')),
        }) : null,
        brainVoiceCard(persistentSelf.voice),
        brainRelationshipCard(persistentSelf.relationships),
    ];
    for (const section of sections) {
        if (section) visual.append(section);
    }
}

function updateBrainViewPanes() {
    const visual = document.getElementById('il_brain_visual');
    const rawPane = document.getElementById('il_brain_raw_pane');
    const mindButton = document.getElementById('il_brain_view_mind');
    const rawButton = document.getElementById('il_brain_view_raw');
    const dirtyBadge = document.getElementById('il_brain_dirty_badge');
    const showVisual = runtime.brainView !== 'raw';
    if (visual) visual.classList.toggle('displayNone', !showVisual);
    if (rawPane) rawPane.classList.toggle('displayNone', showVisual);
    if (mindButton) {
        mindButton.classList.toggle('is-active', showVisual);
        mindButton.setAttribute('aria-selected', String(showVisual));
    }
    if (rawButton) {
        rawButton.classList.toggle('is-active', !showVisual);
        rawButton.setAttribute('aria-selected', String(!showVisual));
    }
    if (dirtyBadge) dirtyBadge.classList.toggle('displayNone', !runtime.brainJsonDirty);
}

const TRIGGER_DURATION_UNITS = Object.freeze({
    seconds: 1,
    minutes: 60,
    hours: 3_600,
    days: 86_400,
});

function durationEditorParts(secondsValue) {
    if (secondsValue === null || secondsValue === undefined || secondsValue === '') {
        return { amount: '', unit: 'minutes' };
    }
    const seconds = Math.max(0, Number(secondsValue) || 0);
    for (const unit of ['days', 'hours', 'minutes']) {
        const factor = TRIGGER_DURATION_UNITS[unit];
        if (seconds >= factor && seconds % factor === 0) return { amount: seconds / factor, unit };
    }
    return { amount: seconds, unit: 'seconds' };
}

function readOptionalDuration(amountId, unitId) {
    const raw = document.getElementById(amountId)?.value;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Event duration values must be zero or greater.');
    const unit = document.getElementById(unitId)?.value;
    return Math.round(amount * (TRIGGER_DURATION_UNITS[unit] || 1));
}

function currentTriggerEventRecord() {
    const store = getChatStore();
    return listTriggerEventRecords(normalizeProgressionState(store?.progression))
        .find(record => record.id === runtime.selectedTriggerEventId) || null;
}

function updateTriggerEventSaveButton(enabledValue) {
    const button = document.getElementById('il_save_trigger_event');
    if (!button) return;
    const enabled = enabledValue ?? Boolean(document.getElementById('il_trigger_event_enabled')?.checked);
    button.innerHTML = enabled
        ? '<i class="fa-solid fa-bolt"></i> Save &amp; Arm Event'
        : '<i class="fa-solid fa-floppy-disk"></i> Save Draft (Disabled)';
    button.title = enabled
        ? 'Save this configuration and arm it from the current story point.'
        : 'Save the configuration as a disabled draft. It cannot trigger.';
}

function renderTriggerEventEditor() {
    const record = currentTriggerEventRecord();
    const store = getChatStore();
    const editor = document.getElementById('il_trigger_event_editor');
    const chip = document.getElementById('il_event_status_chip');
    if (chip) {
        const states = {
            draft: ['is-draft', 'Draft'],
            armed: ['is-armed', 'Armed'],
            active: ['is-active', 'Active · hidden'],
            observable: ['is-observable', 'Observable'],
            revealed: ['is-done', 'Revealed'],
            resolved: ['is-done', 'Finished'],
            cancelled: ['is-done', 'Cancelled'],
        };
        const [cls, label] = (!record || !record.enabled)
            ? ['is-draft', 'Draft']
            : (states[record.status] || ['is-draft', record.status]);
        chip.className = `il-event-chip ${cls}`;
        chip.textContent = label;
        chip.classList.remove('displayNone');
    }
    if (!editor) return;
    editor.classList.toggle('is-empty', !record);
    if (!record) { if (chip) chip.classList.add('displayNone'); return; }

    const triggerDuration = durationEditorParts(record.triggerAfterSeconds);
    const revealDuration = durationEditorParts(record.revealAfterSeconds);
    setInputValue('il_trigger_event_title', record.title);
    setInputValue('il_trigger_event_key', record.key);
    setInputValue('il_trigger_event_description', record.description);
    setInputValue('il_trigger_event_enabled', record.enabled);
    updateTriggerEventSaveButton(record.enabled);
    setInputValue('il_trigger_event_priority', record.priority);
    setInputValue('il_trigger_event_mode', record.triggerMode);
    setInputValue('il_trigger_event_time_basis', record.timeBasis);
    setInputValue('il_trigger_event_time_amount', triggerDuration.amount);
    setInputValue('il_trigger_event_time_unit', triggerDuration.unit);
    setInputValue('il_trigger_event_time_certainty', record.triggerTimeCertainty);
    setInputValue('il_trigger_event_actor_scope', record.actorScope);
    setInputValue('il_trigger_event_action_timing', record.actionTiming);
    setInputValue('il_trigger_event_actor_name', record.actorName);
    setInputValue('il_trigger_event_action', record.actionCondition);
    setInputValue('il_trigger_event_cancel', record.cancellationCondition);
    setInputValue('il_trigger_event_visibility', record.activationVisibility);
    setInputValue('il_trigger_event_reveal_amount', revealDuration.amount);
    setInputValue('il_trigger_event_reveal_unit', revealDuration.unit);
    setInputValue('il_trigger_event_reveal_condition', record.revealCondition);
    setInputValue('il_trigger_event_resolution', record.resolutionCondition);
    setInputValue('il_trigger_event_consequences', record.consequences);
    setInputValue('il_trigger_event_subjects', (record.subjects || []).join(', '));
    document.getElementById('il_trigger_event_named_actor_row')
        ?.classList.toggle('displayNone', record.actorScope !== 'named');

    const statusSummary = !record.enabled
        ? 'DRAFT / DISABLED — This event cannot trigger. Configure a time or action trigger, then enable and save it.'
        : record.status === 'armed'
            ? 'ARMED — Waiting for the configured trigger.'
            : record.status === 'active'
                ? 'TRIGGERED / HIDDEN — Progressing privately; narration cannot show it yet.'
                : record.status === 'observable'
                    ? record.runtime.deliveryStatus === 'failed'
                        ? 'OBSERVABLE / DELIVERY FAILED — Automatic attempts stopped; inspect the trace and retry delivery manually.'
                        : record.runtime.deliveryStatus === 'injected'
                            ? 'OBSERVABLE / SENT — Waiting for the completed story reply to confirm delivery.'
                            : 'OBSERVABLE / PENDING — It will be sent as a mandatory event on the next story generation.'
                    : record.status === 'revealed'
                        ? 'REVEALED — The completed story has made the event public.'
                        : record.status === 'resolved'
                            ? 'FINISHED — Re-arm it to run the event again.'
                            : 'CANCELLED — Re-arm it to make the event eligible again.';
    const stateText = [
        statusSummary,
        `Origin: ${record.origin === 'automatic_director' ? 'Automatic Event Director' : 'User authored'}`,
        `Internal status: ${record.status}`,
        record.runtime.creationAnchorPending ? 'Relative timer anchor pending progression catch-up' : '',
        `Created at message ${record.createdAtMessage}; clock anchor ${formatStoryDuration(record.createdAtElapsedSeconds)}`,
        record.runtime.triggeredAtElapsedSeconds === null
            ? ''
            : `Triggered at ${formatStoryDuration(record.runtime.triggeredAtElapsedSeconds)} (message ${record.runtime.triggeredAtMessage})`,
        record.runtime.observableAtElapsedSeconds === null
            ? ''
            : `Observable at ${formatStoryDuration(record.runtime.observableAtElapsedSeconds)} (message ${record.runtime.observableAtMessage})`,
        record.runtime.revealedAtElapsedSeconds === null
            ? ''
            : `Publicly revealed at ${formatStoryDuration(record.runtime.revealedAtElapsedSeconds)} (message ${record.runtime.revealedAtMessage})`,
        record.runtime.resolvedAtElapsedSeconds === null
            ? ''
            : `Resolved at ${formatStoryDuration(record.runtime.resolvedAtElapsedSeconds)} (message ${record.runtime.resolvedAtMessage})`,
        record.runtime.cancelledAtElapsedSeconds === null
            ? ''
            : `Cancelled at ${formatStoryDuration(record.runtime.cancelledAtElapsedSeconds)} (message ${record.runtime.cancelledAtMessage})`,
        record.runtime.triggerEvidence?.length ? `Trigger evidence: ${record.runtime.triggerEvidence.join(' | ')}` : '',
        record.runtime.revealEvidence?.length ? `Reveal evidence: ${record.runtime.revealEvidence.join(' | ')}` : '',
        record.runtime.resolutionEvidence?.length ? `Resolution evidence: ${record.runtime.resolutionEvidence.join(' | ')}` : '',
        record.runtime.cancellationEvidence?.length ? `Cancellation evidence: ${record.runtime.cancellationEvidence.join(' | ')}` : '',
        `Delivery status: ${record.runtime.deliveryStatus}; attempts: ${record.runtime.deliveryAttempts}`,
        record.runtime.deliveryId ? `Delivery ID: ${record.runtime.deliveryId}` : '',
        record.runtime.deliveryLastInjectedAtMessage >= 0
            ? `Last sent beside message ${record.runtime.deliveryLastInjectedAtMessage}`
            : '',
        record.runtime.deliveryDeliveredAtMessage >= 0
            ? `Delivery confirmed in message ${record.runtime.deliveryDeliveredAtMessage}`
            : '',
        record.runtime.deliveryFailureReason ? `Delivery issue: ${record.runtime.deliveryFailureReason}` : '',
    ].filter(Boolean).join('\n');
    const stateElement = document.getElementById('il_trigger_event_state');
    if (stateElement) stateElement.textContent = stateText;

    const progression = normalizeProgressionState(store?.progression);
    const request = progression.lastTriggerEvaluatorRequest;
    const evaluatorPayload = request?.eventPayloads?.find(item => item.definitionId === record.id);
    setInputValue(
        'il_trigger_event_evaluator_payload',
        evaluatorPayload?.payload || 'This event was not included in the last recorded evaluator request.',
    );
    setInputValue('il_trigger_event_evaluation_result', JSON.stringify(
        record.runtime.lastEvaluation || { acknowledged: false, reason: 'This event has not been evaluated yet.' },
        null,
        2,
    ));
    const deliveryPrompt = progression.lastTriggerDeliveryPrompt;
    const promptIncludedEvent = deliveryPrompt?.records?.some(item => item.definitionId === record.id);
    setInputValue(
        'il_trigger_event_delivery_prompt',
        promptIncludedEvent
            ? deliveryPrompt.prompt
            : 'No recorded story-generation delivery prompt currently includes this event.',
    );
    const inspectorLines = [
        request
            ? `Last evaluator request: messages ${request.startIndex}–${request.endIndex}; ${request.promptCharacters || 0} prompt characters.`
            : 'No evaluator request has been recorded for this store.',
        record.runtime.lastEvaluation?.acknowledged
            ? `Evaluator acknowledged this event through message ${record.runtime.lastEvaluation.messageIndex}; accepted conditions: ${record.runtime.lastEvaluation.accepted?.join(', ') || 'none'}.`
            : `Evaluator acknowledgement: ${record.runtime.lastEvaluation?.reason || 'not yet received'}`,
        promptIncludedEvent
            ? `Last story prompt recorded at message ${deliveryPrompt.messageIndex} (${deliveryPrompt.generationId}).`
            : 'This event was not part of the last recorded story-delivery prompt.',
    ];
    const inspectorSummary = document.getElementById('il_trigger_event_inspector_summary');
    if (inspectorSummary) inspectorSummary.textContent = inspectorLines.join('\n');
    const retryButton = document.getElementById('il_retry_trigger_event_delivery');
    if (retryButton) {
        retryButton.disabled = record.status !== 'observable';
        retryButton.title = record.status === 'observable'
            ? 'Reset the delivery-attempt counter and send this event again on the next story generation.'
            : 'The event must be observable before story delivery can be retried.';
    }
}

function currentEventProposal() {
    const progression = normalizeProgressionState(getChatStore()?.progression);
    return progression.eventProposals?.[runtime.selectedEventProposalId] || null;
}

function renderEventDirectorUI() {
    const progression = normalizeProgressionState(getChatStore()?.progression);
    const stats = getProgressionStats(progression).eventDirector;
    const metadata = stats.metadata;
    const summary = document.getElementById('il_event_director_summary');
    if (summary) {
        summary.textContent = [
            `${stats.active} active generated event${stats.active === 1 ? '' : 's'} · ${stats.pendingReview} awaiting review · ${stats.expired} expired/superseded`,
            `Last outcome: ${metadata.lastOutcome}${metadata.lastAttemptMessage >= 0 ? ` at message ${metadata.lastAttemptMessage}` : ''}`,
            metadata.lastReason ? `Reason: ${metadata.lastReason}` : '',
            metadata.lastError ? `Error: ${metadata.lastError}` : '',
            `Requests: ${metadata.requestCount}; accepted: ${metadata.acceptedCount}; rejected: ${metadata.rejectedCount}; repaired: ${metadata.repairedCount}`,
        ].filter(Boolean).join('\n');
    }
    const proposal = currentEventProposal();
    setInputValue('il_event_proposal_detail', proposal ? JSON.stringify({
        title: proposal.title,
        status: proposal.status,
        confidence: proposal.confidence,
        rationale: proposal.rationale,
        sourceRefs: proposal.sourceRefs,
        createdAtMessage: proposal.createdAtMessage,
        expiresAtMessage: proposal.expiresAtMessage,
        definition: proposal.definition,
        rejectionReason: proposal.rejectionReason || undefined,
    }, null, 2) : 'No proposal selected.');
    const approve = document.getElementById('il_event_proposal_approve');
    const reject = document.getElementById('il_event_proposal_reject');
    const remove = document.getElementById('il_event_proposal_delete');
    if (approve) approve.disabled = !proposal || proposal.status !== 'proposed';
    if (reject) reject.disabled = !proposal || proposal.status !== 'proposed';
    if (remove) remove.disabled = !proposal;
    const generate = document.getElementById('il_event_director_generate');
    if (generate) generate.disabled = !getSettings().automaticEventDirectorEnabled || !getSettings().worldProgressionEnabled;
}

function refreshEditors() {
    const store = getChatStore();
    const entitySelect = document.getElementById('il_entity_select');
    const brainSelect = document.getElementById('il_brain_select');
    if (!entitySelect || !brainSelect) return;

    const entities = Object.values(store?.entities || {})
        .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    if (!store?.entities?.[runtime.selectedEntityId]) runtime.selectedEntityId = entities[0]?.id || '';
    entitySelect.replaceChildren(new Option(entities.length ? 'Select a lore entry…' : 'No lore entries yet', ''));
    for (const record of entities) entitySelect.append(new Option(`[${record.type}] ${record.name}`, record.id));
    entitySelect.value = runtime.selectedEntityId;

    const brains = Object.values(store?.brains || {}).sort((a, b) => a.name.localeCompare(b.name));
    if (!store?.brains?.[runtime.selectedBrainId]) runtime.selectedBrainId = brains[0]?.id || '';
    brainSelect.replaceChildren(new Option(brains.length ? 'Select a character mind…' : 'No character minds yet', ''));
    for (const brain of brains) brainSelect.append(new Option(brain.name, brain.id));
    brainSelect.value = runtime.selectedBrainId;

    const triggerEventSelect = document.getElementById('il_trigger_event_select');
    if (triggerEventSelect) {
        const triggerEvents = listTriggerEventRecords(normalizeProgressionState(store?.progression))
            .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
        if (!triggerEvents.some(record => record.id === runtime.selectedTriggerEventId)) {
            runtime.selectedTriggerEventId = triggerEvents[0]?.id || '';
        }
        triggerEventSelect.replaceChildren(new Option(
            triggerEvents.length ? 'Select a triggerable event…' : 'No triggerable events yet',
            '',
        ));
        for (const record of triggerEvents) {
            const deliveryLabel = record.status === 'observable' ? `/${record.runtime.deliveryStatus}` : '';
            const statusLabel = record.enabled ? `${record.status}${deliveryLabel}`.toUpperCase() : 'DRAFT — DISABLED';
            const originLabel = record.origin === 'automatic_director' ? 'AUTO' : 'USER';
            triggerEventSelect.append(new Option(`[${originLabel}/${statusLabel}] ${record.title}`, record.id));
        }
        triggerEventSelect.value = runtime.selectedTriggerEventId;
    }

    const proposalSelect = document.getElementById('il_event_proposal_select');
    if (proposalSelect) {
        const proposals = Object.values(normalizeProgressionState(store?.progression).eventProposals || {})
            .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
        if (!proposals.some(proposal => proposal.id === runtime.selectedEventProposalId)) {
            runtime.selectedEventProposalId = proposals[0]?.id || '';
        }
        proposalSelect.replaceChildren(new Option(
            proposals.length ? 'Select an event proposal…' : 'No automatic proposals yet',
            '',
        ));
        for (const proposal of proposals) {
            proposalSelect.append(new Option(
                `[${proposal.status.toUpperCase()} / ${Math.round(proposal.confidence * 100)}%] ${proposal.title}`,
                proposal.id,
            ));
        }
        proposalSelect.value = runtime.selectedEventProposalId;
    }

    const active = document.activeElement;
    if (!active?.closest?.('#il_entity_editor')) renderEntityEditor();
    if (!active?.closest?.('#il_brain_editor')) renderBrainEditor();
    if (!active?.closest?.('#il_trigger_event_editor')) renderTriggerEventEditor();
    renderEventDirectorUI();
}

function updateUI() {
    const store = getChatStore();
    const stats = document.getElementById('il_stats');
    if (stats) {
        if (!store) {
            stats.textContent = 'Open a character or group chat to begin.';
        } else {
            const entityCount = Object.keys(store.entities || {}).length;
            const brainCount = Object.keys(store.brains || {}).length;
            const psychologyCount = Object.values(store.brains || {})
                .reduce((sum, brain) => sum + brainPsychologyCount(brain), 0);
            const progression = getProgressionStats(store.progression);
            const progressionWatermark = settingsWorldProgressionWatermark(store);
            const combinedWatermark = Math.min(store.lastProcessedIndex, progressionWatermark);
            const pending = Math.max(0, context().chat.length - 1 - combinedWatermark);
            const rebuild = store.needsRebuild ? ' · <b>rebuild required</b>' : '';
            stats.innerHTML = `<b>${entityCount}</b> lore entries · <b>${brainCount}</b> minds · <b>${psychologyCount}</b> psychological records · <b>${pending}</b> unprocessed messages${rebuild}<br><b>${escapeHtml(progression.clock)}</b> elapsed · <b>${progression.activeGoals}</b> active goals · <b>${progression.activeProcesses}</b> processes · <b>${progression.due}</b> due/possible beats<br><b>${progression.triggerEvents.enabled}</b> enabled trigger events · <b>${progression.activeTriggerEvents}</b> active · <b>${progression.observableTriggerEvents}</b> observable · <b>${progression.triggerEvents.pendingDelivery}</b> awaiting delivery · <b>${progression.triggerEvents.failedDelivery}</b> need review<br><b>${progression.eventDirector.pendingReview}</b> director proposals · <b>${progression.eventDirector.active}</b> generated events active${store.lorebookName ? `<br><small>${escapeHtml(store.lorebookName)}</small>` : ''}`;
        }
    }
    refreshEditors();
    setStatus(runtime.statusKind, runtime.statusLabel, runtime.statusDetail);
    updateInjection();
}

function settingsWorldProgressionWatermark(store) {
    return getSettings().worldProgressionEnabled
        ? normalizeProgressionState(store?.progression).lastProcessedIndex
        : store?.lastProcessedIndex ?? -1;
}

function getCardContext() {
    try {
        return formatCharacterCard(context().getCharacterCardFields?.() || {});
    } catch (error) {
        log('Could not read character-card fields:', error);
        return '';
    }
}

function getCardSeedEntities() {
    try {
        const ctx = context();
        const card = ctx.characters?.[ctx.characterId]
            || (ctx.name2 ? ctx.characters?.find(candidate => candidate?.name === ctx.name2) : null);
        return parseCardSeedEntities(card);
    } catch (error) {
        log('Could not read card seed entities:', error);
        return [];
    }
}

// A card may declare canon entities (typically its locations) so a chat with
// no existing InnerLore world starts with the scenario's map already tracked.
// Seeds are ordinary records: the curator enriches them as play actually
// reaches each place, and entity types disabled in settings are respected.
function seedNewStoreFromCard(store) {
    const seeds = getCardSeedEntities();
    if (!seeds.length) return 0;
    const settings = getSettings();
    const result = mergeEntityOperations(store, seeds, {
        enabledTypes: settings.enabledEntityTypes,
        minimumImportance: 0,
        maximumOperations: Math.max(1, seeds.length),
        messageIndex: -1,
    });
    const seeded = Number(result.created) || 0;
    if (seeded) log(`Seeded ${seeded} card-declared entit${seeded === 1 ? 'y' : 'ies'} into the new chat world.`);
    return seeded;
}

async function analyzeRange(targetStore, startIndex, endIndex, options = {}) {
    const settings = getSettings();
    const ctx = context();
    targetStore.progression = normalizeProgressionState(targetStore.progression);
    const curatorEnabled = (settings.innerSelfEnabled || settings.autoLoreEnabled)
        && options.curatorEnabled !== false;
    const curatorStart = Math.max(startIndex, targetStore.lastProcessedIndex + 1);
    // Never curate a dangling player action or an empty swipe placeholder as a
    // completed exchange. The next assistant reply will include it again from
    // the unchanged watermark.
    const curatorEnd = lastCompletedStoryIndex(ctx.chat, endIndex);
    const progressionStart = Math.max(0, targetStore.progression.lastProcessedIndex + 1);
    const progressionCandidateEnd = lastCompletedStoryIndex(ctx.chat, endIndex);
    const progressionPending = progressionCandidateEnd >= progressionStart
        ? progressionCandidateEnd - progressionStart + 1
        : 0;
    const progressionAssistantTurns = completedAssistantTurnCount(
        ctx.chat,
        progressionStart,
        progressionCandidateEnd,
    );
    const progressionThreshold = options.progressionMode === 'rebuild'
        ? Math.max(1, Number(settings.progressionRebuildBatchMessages) || 30)
        : Math.max(1, Number(settings.progressionEveryAssistantTurns) || 2);
    const progressionBatchLimit = options.progressionMode === 'rebuild'
        ? Math.max(progressionThreshold, Number(settings.lookbackMessages) || 10)
        : Math.max(2, Number(settings.lookbackMessages) || 10);
    let progressionEnd = boundedProgressionEnd(
        ctx.chat,
        progressionStart,
        progressionCandidateEnd,
        progressionBatchLimit,
    );
    const pendingCreationBoundary = Object.values(targetStore.progression.eventDefinitions || {})
        .filter(definition => targetStore.progression.eventRuntime?.[definition.id]?.creationAnchorPending)
        .map(definition => definition.createdAtMessage)
        .filter(index => Number.isInteger(index) && index >= progressionStart && index <= progressionEnd)
        .sort((a, b) => a - b)[0];
    const progressionAnchorFlush = Number.isInteger(pendingCreationBoundary);
    if (progressionAnchorFlush) progressionEnd = pendingCreationBoundary;
    const runProgression = settings.worldProgressionEnabled
        && options.progressionEnabled !== false
        && progressionPending > 0
        && progressionEnd >= progressionStart
        && (
            (options.progressionMode === 'rebuild'
                ? progressionPending >= progressionThreshold
                : progressionAssistantTurns >= progressionThreshold)
            || options.progressionFlush === true
            || progressionAnchorFlush
        );
    const actualStart = Math.min(
        curatorEnabled && curatorStart <= curatorEnd ? curatorStart : Number.POSITIVE_INFINITY,
        runProgression ? progressionStart : Number.POSITIVE_INFINITY,
    );
    const actualEnd = Math.max(
        curatorEnabled ? curatorEnd : -1,
        runProgression ? progressionEnd : -1,
    );
    const sourceSnapshot = Number.isFinite(actualStart) && actualEnd >= actualStart
        ? snapshotMessageRange(ctx.chat, actualStart, actualEnd)
        : {};
    const transcript = curatorEnabled && curatorStart <= curatorEnd
        ? formatTranscript(ctx.chat, {
            startIndex: curatorStart,
            endIndex: curatorEnd,
            userName: ctx.name1,
            characterName: ctx.name2,
            maximumCharacters: 55_000,
        })
        : '';
    const progressionTranscript = runProgression
        ? formatTranscript(ctx.chat, {
            startIndex: progressionStart,
            endIndex: progressionEnd,
            userName: ctx.name1,
            characterName: ctx.name2,
            maximumCharacters: 90_000,
        })
        : '';

    // Game ledger: the same completed range as the curator, from its own
    // watermark. The scene planner prepares where the player is and can go.
    targetStore.game = normalizeGameState(targetStore.game);
    const gameEnabled = settings.gameEnabled !== false && settings.gameLedgerEnabled !== false
        && options.gameEnabled !== false;
    const gameStart = Math.max(startIndex, targetStore.game.lastProcessedIndex + 1);
    const gameEnd = lastCompletedStoryIndex(ctx.chat, endIndex);
    const gameTranscript = gameEnabled && gameStart <= gameEnd
        ? formatTranscript(ctx.chat, {
            startIndex: gameStart,
            endIndex: gameEnd,
            userName: ctx.name1,
            characterName: ctx.name2,
            maximumCharacters: 40_000,
        })
        : '';
    // The ledger may read from before the curator's range; a swipe or edit
    // there during the pass discards its result too.
    const gameSnapshot = gameTranscript ? snapshotMessageRange(ctx.chat, gameStart, gameEnd) : {};
    const gameScene = settings.gameEnabled !== false && gameEnd >= 0
        ? deriveSceneState(ctx.chat, targetStore, {
            currentIndex: gameEnd,
            playerName: ctx.name1,
            lookbackMessages: settings.sceneLookbackMessages ?? 4,
        })
        : null;
    const plannerWanted = options.plannerEnabled === true && settings.gameEnabled !== false
        && settings.scenePlannerEnabled !== false && gameEnd >= 0;
    // A brand-new world has no places until the curator reads the opening,
    // so the planner waits for those first records instead of guessing.
    const deferPlanner = plannerWanted && Boolean(transcript)
        && !Object.values(targetStore.entities || {}).some(record => record?.type === 'location' && record.enabled !== false);
    const plannerPlan = plannerWanted && !deferPlanner && gameScene
        ? plannerPlanFor(targetStore, gameScene, gameEnd, settings, ctx.name1)
        : null;

    // The passes commonly share one connection profile, so by default they
    // run one after another and a provider with tight concurrency limits never
    // sees two at once. With parallel passes on they all leave together (the
    // Claude bridge's agent pool runs them inside one request slot). Each
    // result is committed independently below, so a successful subsystem
    // advances even when another fails.
    const signal = runtime.controller?.signal;
    const tasks = [];
    // With a minds profile the curator is two narrower requests: people,
    // places and whereabouts on the curator profile, NPC minds on the minds
    // profile, side by side (on two providers, truly at once).
    const splitMinds = Boolean(transcript) && Boolean(settings.mindsConnectionProfileId)
        && settings.innerSelfEnabled && settings.autoLoreEnabled;
    const curatorRequest = passSettings => requestJsonPatch(passSettings, buildAnalysisMessages({
        transcript,
        store: targetStore,
        currentIndex: curatorEnd,
        characterCard: getCardContext(),
        playerName: ctx.name1,
        recentExpressionText: collectRecentStoryExpressions(ctx.chat, {
            endIndex: curatorEnd,
            maximumReplies: 3,
            maximumCharacters: 1_600,
        }),
        assisted: assistedFor(passSettings.connectionProfileId || settings.connectionProfileId),
        settings: passSettings,
    }), signal);
    if (transcript && splitMinds) {
        tasks.push(['curator', () => curatorRequest({ ...settings, innerSelfEnabled: false, telemetryKind: 'curator' })]);
        tasks.push(['minds', () => curatorRequest({
            ...settings,
            autoLoreEnabled: false,
            connectionProfileId: settings.mindsConnectionProfileId,
            telemetryKind: 'minds',
        })]);
    } else if (transcript) {
        tasks.push(['curator', () => curatorRequest(settings)]);
    }
    if (progressionTranscript) {
        tasks.push(['progression', () => {
            const eventEvaluationDefinitions = triggerEventAgentSnapshot(targetStore.progression, {
                currentIndex: progressionEnd,
            });
            const eventEvaluationKeys = eventEvaluationDefinitions.map(definition => definition.key);
            const progressionMessages = buildProgressionMessages({
                transcript: progressionTranscript,
                store: targetStore,
                progression: targetStore.progression,
                currentIndex: progressionEnd,
                characterCard: getCardContext(),
                playerName: ctx.name1,
                assisted: assistedFor(settings.progressionConnectionProfileId || settings.connectionProfileId),
                settings,
            });
            targetStore.progression.lastTriggerEvaluatorRequest = {
                startIndex: progressionStart,
                endIndex: progressionEnd,
                eventKeys: eventEvaluationKeys,
                eventPayloads: eventEvaluationDefinitions.map(definition => ({
                    definitionId: definition.id,
                    key: definition.key,
                    payload: JSON.stringify(definition, null, 2),
                })),
                promptCharacters: progressionMessages.reduce((sum, message) => sum + message.content.length, 0),
                requestedAt: Date.now(),
            };
            return requestProgressionPatch(
                settings,
                progressionMessages,
                signal,
                {
                    expectedEventKeys: eventEvaluationKeys,
                    expectedEventContracts: Object.fromEntries(eventEvaluationDefinitions.map(definition => [
                        definition.key,
                        {
                            createdAtMessage: definition.created_at_message,
                            actionCondition: definition.action_condition,
                            actorScope: definition.actor_scope,
                            actorName: definition.actor_name,
                            cancellationCondition: definition.cancellation_condition,
                            revealCondition: definition.reveal_condition,
                            resolutionCondition: definition.resolution_condition,
                        },
                    ])),
                    passageStartIndex: progressionStart,
                    passageEndIndex: progressionEnd,
                    playerName: ctx.name1,
                    assisted: assistedFor(settings.progressionConnectionProfileId || settings.connectionProfileId),
                },
            );
        }]);
    }
    const ledgerAssisted = Boolean(gameTranscript) && assistedFor(settings.gameConnectionProfileId || settings.connectionProfileId);
    if (gameTranscript) {
        tasks.push(['game', () => requestGamePatch(settings, buildLedgerMessages({
            game: targetStore.game,
            store: targetStore,
            scene: gameScene,
            playerName: ctx.name1,
            transcript: gameTranscript,
            characterCard: getCardContext(),
            settings,
            assisted: ledgerAssisted,
            alreadyRecorded: alreadyRecordedLines(targetStore, gameStart, gameEnd, ctx.name1),
        }), signal, 'game')]);
    }
    if (plannerPlan) {
        tasks.push(['planner', () => requestGamePatch(settings, plannerMessagesFor(targetStore, plannerPlan), signal, 'planner')]);
    }
    const outcomes = await runBackgroundTasks(tasks, settings.parallelBackgroundPasses === true, signal);
    for (const outcome of Object.values(outcomes)) {
        if (outcome.error?.name === 'AbortError') throw outcome.error;
    }
    if (signal?.aborted) throw new DOMException('InnerLore pass stopped', 'AbortError');
    const response = outcomes.curator?.value ?? null;
    const curatorError = outcomes.curator?.error ?? null;
    const mindsResponse = splitMinds ? outcomes.minds?.value ?? null : response;
    const mindsError = splitMinds ? outcomes.minds?.error ?? null : null;
    const progressionResponse = outcomes.progression?.value ?? null;
    const progressionError = outcomes.progression?.error ?? null;
    const gameResponse = outcomes.game?.value ?? null;
    const gameError = outcomes.game?.error ?? null;
    const plannerResponse = outcomes.planner?.value ?? null;
    const plannerError = outcomes.planner?.error ?? null;
    if (!messageRangeMatchesSnapshot(ctx.chat, sourceSnapshot) || !messageRangeMatchesSnapshot(ctx.chat, gameSnapshot)) {
        targetStore.needsRebuild = true;
        const error = new Error('Chat history changed while InnerLore was analyzing it; the stale result was discarded.');
        error.name = 'InnerLoreHistoryChangedError';
        throw error;
    }
    const payload = response?.payload && typeof response.payload === 'object' ? response.payload : {};
    const entityOperations = payload.entities || payload.entity_operations || [];
    const alignedEntityOperations = alignExplicitLocationOperations(targetStore, entityOperations, transcript);
    // The player's record anchors the scene and must survive every cap; a
    // provider that never writes one still gets it, and a mind written for
    // the player under any of their names is dropped.
    if (settings.autoLoreEnabled) ensurePlayerEntity(targetStore, { name: ctx.name1, persona: ctx.personaDescription, messageIndex: curatorEnd });
    const playerKeys = playerEntityKeys(targetStore, ctx.name1);
    const mindPayload = mindsResponse?.payload && typeof mindsResponse.payload === 'object' ? mindsResponse.payload : {};
    const mindOperations = (mindPayload.minds || mindPayload.mind_operations || [])
        .filter(operation => !playerKeys.has(canonicalNameKey(operation?.character)));

    const entityResult = response && settings.autoLoreEnabled
        ? mergeEntityOperations(targetStore, alignedEntityOperations, {
            enabledTypes: settings.enabledEntityTypes,
            minimumImportance: settings.minimumImportance,
            maximumOperations: settings.maximumEntitiesPerPass,
            messageIndex: curatorEnd,
        })
        : { created: 0, updated: 0, skipped: alignedEntityOperations.length, changedIds: [] };
    const mindResult = mindsResponse && settings.innerSelfEnabled
        ? mergeMindOperations(targetStore, mindOperations, {
            maximumOperations: settings.maximumMindOperationsPerPass,
            maximumThoughts: settings.maximumThoughtsPerBrain,
            maximumThoughtChanges: settings.maximumThoughtChangesPerBrain,
            minimumStoryFacetObservations: settings.minimumStoryFacetObservations,
            consolidationSimilarity: settings.brainConsolidationSimilarity,
            maximumSceneThoughts: settings.maximumSceneThoughtsPerBrain,
            messageIndex: curatorEnd,
        })
        : { created: 0, updated: 0, skipped: mindOperations.length, changedIds: [] };
    if (mindsResponse && settings.innerSelfEnabled && structuredFoundationBrains(targetStore).length) {
        // Readiness requires all four real card-backed capabilities; any JSON
        // response by itself is not enough to bless the narration path.
        targetStore.expressionFoundationVersion = EXPRESSION_FOUNDATION_VERSION;
    }
    const mentionResult = transcript ? refreshMentionRecency(targetStore, transcript, curatorEnd, {
        entities: settings.autoLoreEnabled,
        brains: settings.innerSelfEnabled,
    }) : { entities: 0, brains: 0 };

    let progressionResult = null;
    if (progressionResponse) {
        progressionResult = applyProgressionPatch(targetStore.progression, progressionResponse.payload, {
            messageIndex: progressionEnd,
            passageStartIndex: progressionStart,
            passageText: progressionTranscript,
            playerName: ctx.name1,
            autonomy: settings.progressionAutonomy,
            maximumGoals: settings.progressionMaximumGoals,
            maximumProcesses: settings.progressionMaximumProcesses,
            maximumEvents: settings.progressionMaximumEvents,
            evaluationCoverageRequired: true,
            deliveryMaximumAttempts: settings.triggerDeliveryMaximumAttempts,
        });
        targetStore.progression = progressionResult.state;
        const progressionSnapshot = snapshotMessageRange(ctx.chat, progressionStart, progressionEnd);
        for (const [index, fingerprint] of Object.entries(progressionSnapshot)) {
            if (fingerprint) targetStore.progression.processedFingerprints[index] = fingerprint;
        }
        targetStore.progression.lastProcessedIndex = Math.max(
            targetStore.progression.lastProcessedIndex,
            progressionEnd,
        );
        targetStore.progression.lastRunStats = {
            ...targetStore.progression.lastRunStats,
            startIndex: progressionStart,
            endIndex: progressionEnd,
            repaired: progressionResponse.repaired,
            codec: codecStatsFromResponse(progressionResponse),
        };
        targetStore.progression.lastError = '';
    } else if (progressionError) {
        targetStore.progression.lastError = cleanString(progressionError.message || String(progressionError), 1_000);
    } else if (settings.worldProgressionEnabled
        && progressionStart <= endIndex
        && ctx.chat.slice(progressionStart, endIndex + 1).every(message => (
            !message
            || !cleanString(message.mes)
            || (message.is_system && message.extra?.sc_ghosted !== true)
        ))) {
        const ignoredSnapshot = snapshotMessageRange(ctx.chat, progressionStart, endIndex);
        for (const [index, fingerprint] of Object.entries(ignoredSnapshot)) {
            if (fingerprint) targetStore.progression.processedFingerprints[index] = fingerprint;
        }
        targetStore.progression.lastProcessedIndex = endIndex;
    }

    const gameCommit = commitGamePasses(targetStore, {
        ctx,
        settings,
        gameEnabled,
        gameStart,
        gameEnd,
        gameTranscript,
        gameScene,
        gameResponse,
        gameError,
        ledgerAssisted,
        plannerPlan,
        plannerResponse,
        plannerError,
    });

    const curatorSucceeded = !curatorEnabled || !transcript || Boolean(response);
    if (curatorEnabled && curatorStart <= curatorEnd && curatorSucceeded) {
        const curatorSnapshot = snapshotMessageRange(ctx.chat, curatorStart, curatorEnd);
        for (const [index, fingerprint] of Object.entries(curatorSnapshot)) {
            if (fingerprint) targetStore.processedFingerprints[index] = fingerprint;
        }
        targetStore.lastProcessedIndex = Math.max(targetStore.lastProcessedIndex, curatorEnd);
    }
    // After the curator's watermark moves, so the scene trusts its new record
    // of where the player is rather than reading the opening's prose.
    if (deferPlanner && response) {
        const scene = deriveSceneState(ctx.chat, targetStore, {
            currentIndex: gameEnd,
            playerName: ctx.name1,
            lookbackMessages: settings.sceneLookbackMessages ?? 4,
        });
        const plan = plannerPlanFor(targetStore, scene, gameEnd, settings, ctx.name1);
        if (plan) {
            try {
                const reply = await requestGamePatch(settings, plannerMessagesFor(targetStore, plan), signal, 'planner');
                gameCommit.plannerResult = commitPlannerResponse(targetStore, plan, reply, ctx.name1);
            } catch (error) {
                if (error?.name === 'AbortError' || signal?.aborted) throw error;
                targetStore.game.planner = { ...targetStore.game.planner, lastError: cleanString(error?.message || String(error), 1_000) };
            }
        }
    }
    targetStore.lastRunAt = Date.now();
    const curatorCodecStats = codecStatsFromResponse(response);
    targetStore.lastRunStats = {
        startIndex: Number.isFinite(actualStart) ? actualStart : -1,
        endIndex: actualEnd,
        entityResult,
        mindResult,
        mentionResult,
        repaired: Boolean(response?.repaired),
        codec: curatorCodecStats,
        curatorError: curatorError ? cleanString(curatorError.message || String(curatorError), 1_000) : '',
        mindsError: mindsError ? cleanString(mindsError.message || String(mindsError), 1_000) : '',
        progressionResult: progressionResult?.state?.lastRunStats || null,
        progressionError: progressionError ? cleanString(progressionError.message || String(progressionError), 1_000) : '',
        gameResult: gameCommit.gameResult,
        gameError: gameError ? cleanString(gameError.message || String(gameError), 1_000) : '',
        plannerResult: gameCommit.plannerResult,
        plannerError: plannerError ? cleanString(plannerError.message || String(plannerError), 1_000) : '',
    };
    targetStore.updatedAt = Date.now();

    if (options.sync !== false && settings.autoLoreEnabled && entityResult.changedIds.length) {
        await syncLorebook(targetStore, {
            chatId: targetStore.chatId,
            characterName: ctx.name2,
            // Canonical reconciliation can collapse an automatically-created
            // item into its authoritative location record. Remove only those
            // now-missing extension-owned entries so the native lorebook does
            // not keep injecting a ghost duplicate.
            removeMissing: Boolean(entityResult.removedIds?.length),
        });
    }
    if (options.persist !== false) await saveChatStore();
    return {
        entityResult,
        mindResult,
        mentionResult,
        repaired: Boolean(response?.repaired),
        codec: curatorCodecStats,
        progressionResult,
        curatorError,
        progressionError,
        gameResult: gameCommit.gameResult,
        gameError,
        plannerResult: gameCommit.plannerResult,
        plannerError,
        skipped: !response && !progressionResponse && !gameResponse && !plannerResponse,
    };
}

/**
 * Run the background passes of one analysis, one after another or all at
 * once. Returns { name: { value } | { error } } for every pass that ran.
 */
async function runBackgroundTasks(tasks, parallel, signal) {
    const outcomes = {};
    if (parallel && tasks.length > 1) {
        const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
        tasks.forEach(([name], index) => {
            outcomes[name] = settled[index].status === 'fulfilled'
                ? { value: settled[index].value }
                : { error: settled[index].reason };
        });
        return outcomes;
    }
    for (const [name, run] of tasks) {
        try {
            outcomes[name] = { value: await run() };
        } catch (error) {
            outcomes[name] = { error };
            if (error?.name === 'AbortError' || signal?.aborted) break;
        }
    }
    return outcomes;
}

function gamePlaceOf(scene, store) {
    const name = cleanString(scene?.location?.name, 240);
    if (!name) return null;
    const entities = store?.entities || {};
    return placeRefOf((scene.location.id && entities[scene.location.id]) || resolveLocationReference(entities, name), name);
}

/**
 * Commit the game ledger and scene planner results of one analysis. People
 * and objects the planner prepared earlier that the newest replies now show
 * are marked as introduced first, so a stage prepared in this same pass is
 * never mistaken for one the narrator has already used.
 */
function commitGamePasses(targetStore, pass) {
    const { ctx, settings } = pass;
    let gameResult = null;
    let plannerResult = null;
    if (settings.gameEnabled === false || pass.gameEnd < 0) return { gameResult, plannerResult };
    const place = gamePlaceOf(pass.gameScene, targetStore);

    const introducedFrom = Math.max(0, (Number.isInteger(targetStore.game.introducedThrough) ? targetStore.game.introducedThrough : -1) + 1);
    const storyText = ctx.chat.slice(introducedFrom, pass.gameEnd + 1)
        .filter(message => message && !message.is_user && !message.is_system)
        .map(message => message.mes)
        .join('\n\n');
    const introductions = introductionOperations(targetStore.game, storyText, place);
    if (introductions.length) {
        targetStore.game = applyGameOperations(targetStore.game, introductions, { messageIndex: pass.gameEnd, source: 'scene' }).state;
    }
    targetStore.game.introducedThrough = Math.max(introducedFrom - 1, pass.gameEnd);
    // A person the lore has folded into another name keeps one standing.
    const identityFolds = reconcileGameIdentities(targetStore.game, targetStore.entities);
    if (identityFolds.length) {
        targetStore.game = applyGameOperations(targetStore.game, identityFolds, { messageIndex: pass.gameEnd, source: 'lore' }).state;
    }

    const advanceLedger = () => {
        for (const [index, fingerprint] of Object.entries(snapshotMessageRange(ctx.chat, pass.gameStart, pass.gameEnd))) {
            if (fingerprint) targetStore.game.processedFingerprints[index] = fingerprint;
        }
        targetStore.game.lastProcessedIndex = Math.max(targetStore.game.lastProcessedIndex, pass.gameEnd);
    };
    if (pass.gameResponse) {
        const context = gameContext(targetStore.game, { playerName: ctx.name1, entities: targetStore.entities, scenePlace: place });
        // A smaller model's records must quote PASSAGE; the rest are dropped.
        const grounded = pass.ledgerAssisted
            ? groundedRecords(pass.gameResponse.payload, pass.gameTranscript)
            : { payload: pass.gameResponse.payload, dropped: [] };
        const normalized = normalizeGameRecords(grounded.payload, context, { source: 'ledger' });
        // What the game system applied while the passage was written is not recorded twice.
        const deduped = dropDuplicateLedgerOps(normalized.ops, actionEntriesInRange(targetStore.game, pass.gameStart, pass.gameEnd));
        const applied = applyGameOperations(targetStore.game, deduped.ops, { messageIndex: pass.gameEnd, source: 'ledger', rejected: normalized.rejected });
        targetStore.game = applied.state;
        // The story's stated prices replace what the planner had guessed for the same kind of thing here.
        const retired = supersededPlannerPrices(targetStore.game, applied.applied.map(entry => entry.op));
        if (retired.length) targetStore.game = applyGameOperations(targetStore.game, retired, { messageIndex: pass.gameEnd, source: 'lore' }).state;
        advanceLedger();
        gameResult = {
            startIndex: pass.gameStart,
            endIndex: pass.gameEnd,
            applied: applied.applied.length,
            introduced: introductions.length,
            ungrounded: grounded.dropped.length,
            duplicates: deduped.dropped.length,
            rejected: applied.rejected.slice(0, 12),
            shortfall: applied.applied.reduce((sum, entry) => sum + (entry.shortfall || 0), 0),
            retiredPrices: retired.length,
            repaired: Boolean(pass.gameResponse.repaired),
            codec: codecStatsFromResponse(pass.gameResponse),
        };
        targetStore.game.lastRunStats = { ...gameResult, at: Date.now() };
        targetStore.game.lastError = '';
    } else if (pass.gameError) {
        targetStore.game.lastError = cleanString(pass.gameError.message || String(pass.gameError), 1_000);
    } else if (pass.gameEnabled && pass.gameStart <= pass.gameEnd && !pass.gameTranscript) {
        // Nothing readable in the range (hidden or empty messages): skip it.
        advanceLedger();
    }

    if (pass.plannerResponse && pass.plannerPlan) {
        plannerResult = commitPlannerResponse(targetStore, pass.plannerPlan, pass.plannerResponse, ctx.name1);
    } else if (pass.plannerError) {
        targetStore.game.planner = {
            ...targetStore.game.planner,
            lastError: cleanString(pass.plannerError.message || String(pass.plannerError), 1_000),
        };
    }
    return { gameResult, plannerResult };
}

function codecStatsFromResponse(response) {
    if (!response) return null;
    const diagnostics = Array.isArray(response.parseDiagnostics) ? response.parseDiagnostics : [];
    const normalizations = {};
    for (const item of diagnostics) {
        if (!item?.code) continue;
        normalizations[item.code] = (normalizations[item.code] || 0) + 1;
    }
    return {
        format: response.outputFormat === 'dsl' ? 'dsl' : 'json',
        repaired: Boolean(response.repaired),
        salvaged: diagnostics.some(item => (
            item.code === 'truncated_tail_dropped' || item.code === 'missing_done_salvaged'
        )),
        crossFormat: diagnostics.some(item => item.code === 'cross_format_json_accepted'),
        normalizations,
        firstError: cleanString(response.firstError, 500),
    };
}

function mergeCodecSignals(accumulator, codec) {
    if (!codec || typeof codec !== 'object') return accumulator;
    return {
        seen: true,
        format: codec.format === 'dsl' || accumulator.format === 'dsl' ? 'dsl' : 'json',
        salvaged: accumulator.salvaged || Boolean(codec.salvaged),
        crossFormat: accumulator.crossFormat || Boolean(codec.crossFormat),
        repaired: accumulator.repaired || Boolean(codec.repaired),
        normalizations: accumulator.normalizations
            + Object.values(codec.normalizations || {}).reduce((sum, value) => sum + value, 0),
    };
}

function summarizeRun(result) {
    if (!result) return 'No narrative text required analysis.';
    if (result.skipped && result.progressionError) {
        return `World progression deferred (${result.progressionError.message || result.progressionError}).`;
    }
    if (result.skipped && result.gameError) return `Game ledger deferred (${result.gameError.message || result.gameError}).`;
    if (result.skipped) return 'No narrative text required analysis.';
    const entities = result.entityResult || {};
    const minds = result.mindResult || {};
    const progression = result.progressionResult;
    const curatorText = result.curatorError
        ? `; curator deferred (${result.curatorError.message || result.curatorError})`
        : '';
    const progressionText = progression
        ? `; story clock +${formatClockRange({
            minimumSeconds: progression.timeResult?.duration?.minimumSeconds || 0,
            estimatedSeconds: progression.timeResult?.duration?.estimatedSeconds || 0,
            maximumSeconds: progression.timeResult?.duration?.maximumSeconds || 0,
        })}${progression.triggerEventResult?.transitions?.length
            ? `; ${progression.triggerEventResult.transitions.length} editor event transition${progression.triggerEventResult.transitions.length === 1 ? '' : 's'}`
            : ''}${progression.triggerEventResult?.deliveryConfirmed?.length
            ? `; ${progression.triggerEventResult.deliveryConfirmed.length} event delivery confirmed`
            : ''}${progression.triggerEventResult?.deliveryRetries?.length
            ? `; ${progression.triggerEventResult.deliveryRetries.length} event delivery retry queued`
            : ''}${progression.triggerEventResult?.deliveryFailures?.length
            ? `; ${progression.triggerEventResult.deliveryFailures.length} event delivery needs manual review`
            : ''}`
        : result.progressionError
            ? `; progression deferred (${result.progressionError.message || result.progressionError})`
            : '';
    const game = result.gameResult;
    const gameText = game
        ? `; game ledger ${game.applied} change${game.applied === 1 ? '' : 's'}${game.introduced ? `, ${game.introduced} prepared ${game.introduced === 1 ? 'thing' : 'things'} now in the story` : ''}${game.shortfall ? '; a payment was larger than the purse' : ''}`
        : result.gameError
            ? `; game ledger deferred (${result.gameError.message || result.gameError})`
            : '';
    const planner = result.plannerResult;
    const plannerText = planner
        ? `; planner prepared ${planner.places.length ? planner.places.join(', ') : 'nothing new'}${planner.startingKit ? ' and a starting kit' : ''}`
        : result.plannerError
            ? `; planner deferred (${result.plannerError.message || result.plannerError})`
            : '';
    const director = result.eventDirectorResult;
    const directorText = director?.generated
        ? `; Event Director ${director.definition ? 'armed' : 'proposed'} “${director.proposal?.title || 'event'}”`
        : director?.error
            ? `; Event Director deferred (${director.error.message || director.error})`
            : '';
    const codecTotals = [result.codec, progression?.state?.lastRunStats?.codec, director?.codec]
        .reduce(mergeCodecSignals, {
            seen: false, format: 'json', salvaged: false, crossFormat: false, repaired: false, normalizations: 0,
        });
    const codecParts = [];
    if (codecTotals.salvaged) codecParts.push('salvaged a truncated response');
    if (codecTotals.crossFormat) codecParts.push('accepted a JSON fallback');
    if (codecTotals.normalizations) {
        codecParts.push(`${codecTotals.normalizations} local normalization${codecTotals.normalizations === 1 ? '' : 's'}`);
    }
    if (codecTotals.repaired) codecParts.push('one repair round');
    const codecText = codecParts.length
        ? `; ${codecTotals.format === 'dsl' ? 'DSL' : 'JSON'}: ${codecParts.join(', ')}`
        : '';
    return `${entities.created || 0} lore entries created, ${entities.updated || 0} updated; ${minds.created || 0} minds created, ${minds.updated || 0} updated${curatorText}${progressionText}${gameText}${plannerText}${directorText}${codecText}.`;
}

function pendingAnalysisState(store = getChatStore()) {
    const settings = getSettings();
    const messages = context().chat || [];
    const targetIndex = lastCompletedStoryIndex(messages);
    if (!store || targetIndex < 0) return { pending: false, targetIndex };
    const decision = decideInnerLoreMaintenance({ messages, store, settings, targetIndex });
    const curatorDue = (settings.innerSelfEnabled || settings.autoLoreEnabled) && decision.curatorDue;
    const progressionDue = settings.worldProgressionEnabled && decision.progressionDue;
    const gameDue = gameLedgerDue(store, settings, targetIndex);
    return {
        pending: curatorDue || progressionDue || gameDue,
        gameDue,
        curatorPending: decision.curatorPendingTurns > 0,
        progressionPending: decision.progressionPendingTurns > 0,
        curatorDue,
        progressionDue,
        targetIndex,
        decision,
    };
}

/** The ledger runs after every completed reply it has not yet read. */
function gameLedgerDue(store, settings, targetIndex) {
    if (settings.gameEnabled === false || settings.gameLedgerEnabled === false || targetIndex < 0) return false;
    const game = normalizeGameState(store?.game);
    return game.lastProcessedIndex < targetIndex;
}

/**
 * A chat that existed before the game system was switched on is not read
 * from its first message: the ledger starts from the recent window, and the
 * planner gives the player a starting kit consistent with where things stand.
 */
function adoptGameLedger(store, settings, targetIndex) {
    if (settings.gameEnabled === false || !store) return;
    store.game = normalizeGameState(store.game);
    if (store.game.lastProcessedIndex >= 0 || store.game.journal.length) return;
    const window = Math.max(2, Number(settings.lookbackMessages) || 10);
    if (targetIndex >= window) store.game.lastProcessedIndex = targetIndex - window;
}

function clearAnalysisRetry() {
    clearTimeout(runtime.retryTimer);
    runtime.retryTimer = null;
}

function scheduleAnalysisRetry(store) {
    clearAnalysisRetry();
    if (!getSettings().autoUpdate || !pendingAnalysisState(store).pending) return;
    const failure = Math.max(1, Number(store.consecutiveFailures) || 1);
    const delays = [5_000, 15_000, 45_000];
    if (failure > delays.length) {
        store.nextRetryAt = 0;
        context().saveMetadataDebounced?.();
        return;
    }
    const delay = delays[failure - 1];
    store.nextRetryAt = Date.now() + delay;
    context().saveMetadataDebounced?.();
    setStatus('error', 'Retry scheduled', `${store.lastError} Retrying in ${Math.round(delay / 1_000)} seconds.`.trim());
    runtime.retryTimer = setTimeout(() => {
        runtime.retryTimer = null;
        const currentStore = getChatStore();
        if (!currentStore || !pendingAnalysisState(currentStore).pending) return;
        processPending({ force: true, silent: true });
    }, delay);
}

function throwForSubsystemFailure(result) {
    const failures = [];
    if (result?.curatorError) failures.push(`continuity curator: ${result.curatorError.message || result.curatorError}`);
    if (result?.progressionError) failures.push(`world progression: ${result.progressionError.message || result.progressionError}`);
    // A failed ledger keeps its watermark, so the retry re-reads the same
    // replies. The scene planner is preparation only and simply runs again.
    if (result?.gameError) failures.push(`game ledger: ${result.gameError.message || result.gameError}`);
    if (!failures.length) return;
    const error = new Error(failures.join('; '));
    error.name = 'InnerLoreSubsystemError';
    throw error;
}

// The story's claim on its request slot, with an expiry so a generation that
// never reports back (typically a quiet one) cannot hold it forever.
function storyClaimFresh() {
    return Boolean(runtime.storyRequestInFlight)
        && Date.now() - (runtime.storyRequestInFlightAt || 0) < (
            runtime.storyClaimIsQuiet ? 90_000 : 480_000);
}

function releaseStaleStoryClaim() {
    if (runtime.storyRequestInFlight && !storyClaimFresh()) {
        console.warn('[InnerLore] A story-slot claim went stale (likely a quiet generation with no message event); releasing it.');
        runtime.storyRequestInFlight = false;
        runtime.announceStoryState?.(false);
    }
}

/**
 * With two request slots the story never waits for InnerLore, so a pass that
 * would begin while a reply is still being written would read that reply
 * half-finished. It is held here under `key` and starts once the reply is
 * done. A pass that was already running simply carries on in the second slot.
 */
function deferWhileStoryWrites(key, start) {
    if (providerConcurrency(getSettings()) < 2 || !storyClaimFresh()) return false;
    runtime.afterStory.set(key, start);
    runtime.afterStoryWaiter ??= (async () => {
        while (storyClaimFresh()) await new Promise(resolve => setTimeout(resolve, 1_000));
        releaseStaleStoryClaim();
        runtime.afterStoryWaiter = null;
        const deferred = [...runtime.afterStory.values()];
        runtime.afterStory.clear();
        for (const run of deferred) run();
    })();
    return true;
}

async function processPending({ force = false, silent = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled || (!settings.innerSelfEnabled && !settings.autoLoreEnabled && !settings.worldProgressionEnabled)) return;
    if (runtime.processing || runtime.rebuilding || runtime.preparingFoundation) {
        runtime.queued = true;
        return;
    }
    if (deferWhileStoryWrites(force ? 'pass:forced' : 'pass', () => processPending({ force, silent }))) return;
    const store = getChatStore();
    const ctx = context();
    if (!store || !ctx.chat.length) return;
    clearAnalysisRetry();
    store.nextRetryAt = 0;
    if (store.needsRebuild) {
        if (settings.autoRebuildOnHistoryChange) {
            runtime.historyRebuildQueued = true;
            scheduleQueuedHistoryRebuild(0);
            setStatus('working', 'Rebuild queued', 'History changed; stale InnerLore state is quarantined until rebuilding completes.');
        } else {
            setStatus('error', 'Rebuild needed', 'History changed. Use Rebuild From Chat before scanning new turns.');
        }
        updateUI();
        return;
    }
    const targetIndex = lastCompletedStoryIndex(ctx.chat);
    if (targetIndex < 0) return;
    const decision = decideInnerLoreMaintenance({
        messages: ctx.chat,
        store,
        settings,
        targetIndex,
    });
    const runCurator = (settings.innerSelfEnabled || settings.autoLoreEnabled)
        && (force || decision.curatorDue);
    const runProgression = settings.worldProgressionEnabled
        && (force || decision.progressionDue);
    adoptGameLedger(store, settings, targetIndex);
    const runGame = gameLedgerDue(store, settings, targetIndex);
    if (!force && (!settings.autoUpdate || (!runCurator && !runProgression && !runGame))) return;

    // Capture the completed-turn queue that this pass is responsible for. A
    // newer story reply may arrive while the model request is in flight; its
    // queue increment must survive this pass rather than being erased by a
    // blanket reset on success.
    const assistantTurnsCoveredAtStart = Math.max(0, Number(store.assistantTurnsSincePass) || 0);

    const runChatId = currentChatId();
    const progressionStart = runProgression
        ? normalizeProgressionState(store.progression).lastProcessedIndex + 1
        : Number.POSITIVE_INFINITY;
    const curatorStart = runCurator
        ? store.lastProcessedIndex + 1
        : Number.POSITIVE_INFINITY;
    const gameStart = runGame
        ? normalizeGameState(store.game).lastProcessedIndex + 1
        : Number.POSITIVE_INFINITY;
    let startIndex = Math.max(0, Math.min(curatorStart, progressionStart, gameStart));
    const finalIndex = targetIndex;
    if (startIndex > finalIndex) {
        if (!force) return;
        startIndex = Math.max(0, finalIndex - settings.lookbackMessages + 1);
    }

    runtime.processing = true;
    runtime.controller = new AbortController();
    setStatus('working', 'Analyzing', `Processing messages ${startIndex}–${finalIndex}…`);
    let latestResult = null;
    try {
        while (startIndex <= finalIndex) {
            const batchEnd = completedRebuildBatchEnd(
                ctx.chat,
                startIndex,
                finalIndex,
                settings.lookbackMessages,
            );
            if (batchEnd < startIndex) break;
            setStatus('working', 'Analyzing', `Processing messages ${startIndex}–${batchEnd}…`);
            latestResult = await analyzeRange(store, startIndex, batchEnd, {
                curatorEnabled: runCurator,
                progressionEnabled: runProgression,
                progressionFlush: runProgression,
                gameEnabled: runGame,
                // Prepare places once, against the newest reply.
                plannerEnabled: batchEnd >= finalIndex,
            });
            throwForSubsystemFailure(latestResult);
            if (currentChatId() !== runChatId) throw new DOMException('Chat changed', 'AbortError');
            startIndex = batchEnd + 1;
        }
        const expectedProgressionIndex = lastCompletedStoryIndex(ctx.chat, finalIndex);
        while (runProgression
            && !latestResult?.progressionError
            && store.progression.lastProcessedIndex < expectedProgressionIndex) {
            const before = store.progression.lastProcessedIndex;
            latestResult = await analyzeRange(store, before + 1, expectedProgressionIndex, {
                progressionFlush: true,
                curatorEnabled: false,
                progressionEnabled: true,
                gameEnabled: false,
            });
            throwForSubsystemFailure(latestResult);
            if (store.progression.lastProcessedIndex <= before) break;
        }
        if (runCurator) {
            store.assistantTurnsSincePass = Math.max(
                0,
                (Number(store.assistantTurnsSincePass) || 0) - assistantTurnsCoveredAtStart,
            );
        }
        store.lastMaintenanceDecision = {
            ...decision,
            runCurator,
            runProgression,
            forced: force,
            completedAt: Date.now(),
        };
        store.lastError = '';
        store.lastFailureAt = 0;
        store.consecutiveFailures = 0;
        store.nextRetryAt = 0;
        maybeRecordCheckpoint(store, settings);
        await saveChatStore();
        const eventDirectorResult = await maybeRunAutomaticEventDirector();
        if (latestResult) latestResult.eventDirectorResult = eventDirectorResult;
        updateInjection();
        const detail = summarizeRun(latestResult);
        setStatus('success', 'Up to date', detail);
        if (!silent) toastr.success(detail, DISPLAY_NAME, { timeOut: 3_000 });
    } catch (error) {
        if (error?.name === 'AbortError' || runtime.controller?.signal.aborted) {
            setStatus('idle', 'Stopped', 'The current InnerLore pass was stopped without discarding existing state.');
        } else if (error?.name === 'InnerLoreHistoryChangedError') {
            store.needsRebuild = true;
            runtime.historyRebuildQueued = true;
            await saveChatStore();
            setStatus('working', 'Rebuild queued', 'A swipe or edit occurred during analysis. The stale result was discarded.');
        } else {
            console.error(LOG_PREFIX, 'Analysis failed:', error);
            store.lastError = cleanString(error.message || String(error), 2_000);
            store.lastFailureAt = Date.now();
            store.consecutiveFailures = Math.max(0, Number(store.consecutiveFailures) || 0) + 1;
            await saveChatStore();
            setStatus('error', 'Update failed', store.lastError);
            scheduleAnalysisRetry(store);
            if (!silent) toastr.error(error.message || String(error), DISPLAY_NAME, { timeOut: 8_000 });
        }
    } finally {
        runtime.processing = false;
        runtime.controller = null;
        updateUI();
        if (currentChatId() === runChatId && getSettings().autoRebuildOnHistoryChange
            && (runtime.historyRebuildQueued || getChatStore()?.needsRebuild)) {
            runtime.queued = false;
            runtime.historyRebuildQueued = true;
            scheduleQueuedHistoryRebuild(250);
        } else if (runtime.queued) {
            runtime.queued = false;
            // Re-evaluate the independent watermarks. A queued explicit event
            // can flush progression without needlessly re-running the curator.
            setTimeout(() => processPending({ silent: true }), 250);
        }
    }
}

/**
 * What the planner should prepare for this scene: where the player is when it
 * has no stage (or a stale one), places reachable from it, and the starting
 * kit while the purse was never counted. Null when nothing is needed.
 */
function plannerPlanFor(store, scene, index, settings, playerName, { heading = false, prefetch = settings.scenePlannerPrefetch !== false } = {}) {
    if (!scene?.location?.name) return null;
    store.game = normalizeGameState(store.game);
    const targets = plannerTargets(store.game, {
        store,
        scene,
        heading,
        camera: prefetch ? deriveCameraFrame(scene, store, { playerName }) : null,
        clockSeconds: Number(store.progression?.clock?.estimatedSeconds),
        staleSeconds: Math.max(1, Number(settings.scenePlannerStaleHours) || 8) * 3_600,
        prefetch,
        maximum: prefetch ? Math.max(1, Math.min(3, Number(settings.scenePlannerMaximumPlaces) || 2)) : 1,
    });
    const startingKit = needsStartingKit(store.game) && !store.game.planner?.kitOffered;
    return targets.length || startingKit ? { targets, startingKit, index } : null;
}

/** The profile the scene planner runs on: its own, else the progression profile, else the curator's. */
function plannerProfileId(settings) {
    return settings.plannerConnectionProfileId || settings.progressionConnectionProfileId || settings.connectionProfileId;
}

function plannerMessagesFor(store, plan) {
    const ctx = context();
    const end = plan.atSend ? ctx.chat.length - 1 : plan.index;
    return buildPlannerMessages({
        game: store.game,
        store,
        targets: plan.targets,
        startingKit: plan.startingKit,
        assisted: assistedFor(plannerProfileId(getSettings())),
        playerName: ctx.name1,
        persona: ctx.personaDescription,
        characterCard: getCardContext(),
        clockLabel: store.progression?.clock?.currentTimeLabel,
        recentTranscript: formatTranscript(ctx.chat, {
            startIndex: Math.max(0, end - 3),
            endIndex: end,
            userName: ctx.name1,
            characterName: ctx.name2,
            maximumCharacters: 12_000,
        }),
        settings: getSettings(),
    });
}

/** Apply a scene planner answer to the store's game state. */
function commitPlannerResponse(targetStore, plan, response, playerName) {
    targetStore.game = normalizeGameState(targetStore.game);
    const context = gameContext(targetStore.game, { playerName, entities: targetStore.entities });
    const assisted = assistedFor(plannerProfileId(getSettings()));
    const { ops, rejected, adjusted } = normalizeGameRecords(response.payload, context, {
        source: 'planner',
        // The ledger may have just counted the purse from this same passage.
        allowStartingKit: plan.startingKit && needsStartingKit(targetStore.game),
        clockSeconds: Number(targetStore.progression?.clock?.estimatedSeconds),
        // A smaller planner prepares a smaller cast.
        ...(assisted ? { maximumPeoplePerStage: 2 } : {}),
    });
    const applied = applyGameOperations(targetStore.game, ops, { messageIndex: plan.index, source: 'planner', rejected });
    targetStore.game = applied.state;
    // The place the player is at comes first; a planner that prepared only
    // somewhere else is noted, and the next pass targets the place again.
    const placeKeyOf = value => canonicalNameKey(value).replace(/^(?:the|a|an)\s+/u, '');
    const firstTarget = plan.targets[0];
    const missedPlayerPlace = firstTarget && !ops.some(op => op.type === 'stage.set' && placeKeyOf(op.place) === placeKeyOf(firstTarget.name))
        ? firstTarget.name
        : '';
    if (missedPlayerPlace) console.warn(`${LOG_PREFIX} Scene planner prepared nothing for ${missedPlayerPlace}; it is targeted again next pass.`);
    const result = {
        places: plan.targets.map(target => target.name),
        startingKit: plan.startingKit,
        applied: applied.applied.length,
        rejected: applied.rejected.slice(0, 12),
        ...(adjusted?.length ? { adjusted } : {}),
        ...(missedPlayerPlace ? { missedPlayerPlace } : {}),
        repaired: Boolean(response.repaired),
        ...(plan.atSend ? { atSend: true } : {}),
    };
    targetStore.game.planner = {
        ...targetStore.game.planner,
        lastRunIndex: plan.index,
        kitOffered: Boolean(targetStore.game.planner?.kitOffered || plan.startingKit),
        lastRunStats: { ...result, at: Date.now() },
        lastError: '',
    };
    return result;
}

/**
 * When the player's newest turn heads for a place with nothing prepared, or
 * stays somewhere that was never prepared, prepare it now, before the story
 * is written. The story waits for it at prompt time (up to
 * scenePlannerSendWaitSeconds), so the narrator describes the place with the
 * planner's people, objects and prices.
 */
function maybeStageDestination() {
    const settings = getSettings();
    if (!settings.enabled || settings.gameEnabled === false || settings.scenePlannerEnabled === false
        || settings.scenePlannerAtSend === false) return null;
    if (runtime.rebuilding || runtime.destinationPlanner) return null;
    // On a provider that serves one request at a time (NovelAI), a planner
    // call now would only delay the story; the pass after the reply prepares
    // the place instead.
    if (!fitsBesideStory(plannerProfileId(settings))) return null;
    const store = getChatStore();
    const ctx = context();
    if (!store || store.needsRebuild || !ctx.chat.at(-1)?.is_user) return null;
    const scene = deriveSceneState(ctx.chat, store, {
        currentIndex: ctx.chat.length - 1,
        playerName: ctx.name1,
        lookbackMessages: settings.sceneLookbackMessages ?? 4,
    });
    const plan = plannerPlanFor(store, scene, lastCompletedStoryIndex(ctx.chat), settings, ctx.name1, {
        heading: scene.location?.source === 'explicit movement in latest turn',
        prefetch: false,
    });
    if (!plan?.targets.length) return null;
    plan.atSend = true;
    runtime.destinationPlannerPlace = plan.targets[0].name;
    runtime.destinationPlanner = runDestinationPlanner(store, plan).finally(() => {
        runtime.destinationPlanner = null;
        runtime.destinationPlannerPlace = '';
    });
    return runtime.destinationPlanner;
}

async function runDestinationPlanner(store, plan) {
    const settings = getSettings();
    const ctx = context();
    const chatId = currentChatId();
    setStatus('working', 'Preparing', `Preparing ${plan.targets[0].name} before the story arrives there…`);
    try {
        const response = await requestGamePatch(settings, plannerMessagesFor(store, plan), undefined, 'planner');
        if (currentChatId() !== chatId || getChatStore() !== store) return;
        const result = commitPlannerResponse(store, plan, response, ctx.name1);
        await saveChatStore();
        updateInjection();
        setStatus('success', 'Prepared', `Planner prepared ${result.places.join(', ')} before the story arrives.`);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.warn(`${LOG_PREFIX} The scene planner could not prepare the destination:`, error);
        store.game = normalizeGameState(store.game);
        store.game.planner = { ...store.game.planner, lastError: cleanString(error?.message || String(error), 1_000) };
        setStatus('idle', 'Idle', 'The planner could not prepare the destination; the story continues without it.');
    }
}

/**
 * SillyTavern assembles the prompt before it reports it ready, so a story
 * that waited for background work would otherwise carry the packet from
 * before the wait. Swap the delivered packet text for the fresh one.
 */
/**
 * Everything that happens before a story request leaves: the destination
 * planner gets its turn, background work runs first where the provider
 * cannot serve both, `refresh` swaps in the packet if waiting changed it, and
 * the story claims its request slot.
 */
async function departStory(settings, refresh) {
    const packetBefore = runtime.deliveredPacketText || '';
    // Background-first: everything already running - and anything
    // scheduled but not yet started - completes before the story
    // narrates, so the packet carries the freshest world state.
    const scheduledBackground = () => Boolean(
        runtime.queued || runtime.historyRebuildQueued || runtime.foundationPromise
        || runtime.historyTimer || runtime.preparingFoundation);
    const waitStart = Date.now();
    if (runtime.destinationPlanner) {
        const place = runtime.destinationPlannerPlace || 'the destination';
        // A smaller planner takes 40 s and more: the story goes after a short
        // wait and the prepared place lands for the next turn.
        const cap = assistedFor(plannerProfileId(settings)) ? 15 : Infinity;
        const limit = Math.min(cap, Math.max(0, Number(settings.scenePlannerSendWaitSeconds ?? 60))) * 1_000;
        console.debug(`[InnerLore] Preparing ${place} before the story arrives there.`);
        showNarratorPill(`Preparing ${place}`);
        await Promise.race([runtime.destinationPlanner, new Promise(resolve => setTimeout(resolve, limit))]);
        showNarratorPill('Narrating');
    }
    const sharedProvider = storyProvider();
    // A story on a provider that serves one request at a time (NovelAI) would
    // otherwise wait for the pass using it: the pass is stopped (its state is
    // kept; it re-runs after the reply), once per watermark so fast typing
    // cannot starve the world state. NovelAI frees the slot on an abort.
    let preempted = false;
    if (settings.storyPreemptsBackground !== false && isLimitedProvider(sharedProvider)
        && !providerHasRoom(sharedProvider, storyCost()) && backgroundInFlightCount() > 0
        && runtime.controller && !runtime.controller.signal.aborted) {
        const watermark = `${currentChatId()}:${getChatStore()?.lastProcessedIndex ?? -1}`;
        if (runtime.preemptedWatermark !== watermark) {
            runtime.preemptedWatermark = watermark;
            preempted = true;
            console.debug(`[InnerLore] The story preempts the background pass on ${sharedProvider}; the pass re-runs after the reply.`);
            showNarratorPill('Narrating');
            runtime.controller.abort();
            while (!providerHasRoom(sharedProvider, storyCost()) && Date.now() - waitStart < 5_000) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }
    if (providerConcurrency(settings) >= 2 && !providerHasRoom(sharedProvider, storyCost())) {
        // The story runs on a provider with a request budget (NovelAI,
        // Featherless) that background requests are using up: one more would
        // be refused.
        console.debug(`[InnerLore] The story waits for background requests on ${sharedProvider} to leave room.`);
        showNarratorPill('Narrating - background work finishing first');
        while (!providerHasRoom(sharedProvider, storyCost()) && Date.now() - waitStart < 180_000) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        showNarratorPill('Narrating');
    } else if (providerConcurrency(settings) >= 2) {
        console.debug('[InnerLore] Two request slots: the story leaves now; background work keeps the other slot.');
    } else if (!preempted && (backgroundInFlightCount() > 0 || scheduledBackground())) {
        console.debug(`[InnerLore] Background-first: story waiting behind ${backgroundInFlightCount()} in-flight background request(s)${scheduledBackground() ? ' + scheduled work' : ''}.`);
        showNarratorPill('Narrating - background work finishing first');
        try {
            for (;;) {
                await waitForBackgroundIdle();
                if (!scheduledBackground() || Date.now() - waitStart > 120_000) break;
                await new Promise(resolve => setTimeout(resolve, 750));
            }
        } finally {
            console.debug(`[InnerLore] Background-first: background work done after ${Math.round((Date.now() - waitStart) / 1000)}s; the story request leaves now.`);
            showNarratorPill('Narrating');
        }
    } else {
        console.debug('[InnerLore] Background-first: no pending background work; the story request leaves immediately.');
    }
    if (Date.now() - waitStart > 250) refresh(packetBefore);
    recordTelemetryEntry({
        kind: 'story', phase: 'departed',
        preemptedBackground: preempted,
        waitedForBackgroundMs: Date.now() - waitStart,
        timeSinceSentMs: runtime.turnSentAt ? Date.now() - runtime.turnSentAt : 0,
    });
    runtime.storyDepartedAt = Date.now();
    runtime.storyRequestInFlight = true;
    runtime.storyRequestInFlightAt = Date.now();
    runtime.storyClaimIsQuiet = runtime.storyGenerationType === 'quiet';
    runtime.announceStoryState?.(true);
}

function refreshTextPrompt(prompt, packetBefore, memoryBefore) {
    const notes = [packetBefore, ...(runtime.deliveredPacketHistory || [])].filter(Boolean);
    const memories = [memoryBefore, ...(runtime.textMemoryHistory || [])].filter(Boolean);
    updateInjection();
    let text = prompt;
    for (const [earlier, after] of [[notes, runtime.deliveredPacketText || ''], [memories, runtime.lastTextMemory || '']]) {
        const old = [...new Set(earlier)].filter(item => item !== after).sort((a, b) => b.length - a.length)
            .find(item => text.includes(item));
        if (old && after) text = text.replace(old, () => after);
    }
    if (text !== prompt) log('Story packet refreshed in the text prompt after waiting for background work.');
    return text;
}

function refreshPacketInPrompt(prompt, before) {
    const earlier = [before, ...(runtime.deliveredPacketHistory || [])].filter(Boolean);
    updateInjection();
    const after = runtime.deliveredPacketText || '';
    const candidates = [...new Set(earlier)].filter(text => text !== after).sort((a, b) => b.length - a.length);
    if (!after || !candidates.length) return false;
    const messages = Array.isArray(prompt?.chat) ? prompt.chat : (Array.isArray(prompt?.messages) ? prompt.messages : null);
    let replaced = false;
    for (const message of messages || []) {
        if (typeof message?.content !== 'string') continue;
        const old = candidates.find(text => message.content.includes(text));
        if (!old) continue;
        message.content = message.content.replace(old, () => after);
        replaced = true;
    }
    if (replaced) log('Story packet refreshed after waiting for background work.');
    return replaced;
}

/**
 * The prompt view of the story before `boundary`. The game journal is rewound
 * exactly, so a reswipe never sees a purchase from the reply it replaces.
 */
function historyPrefixStore(store, boundary) {
    const prefix = createHistoryPrefixPromptStore(store, boundary);
    prefix.game = gameStateBefore(normalizeGameState(store?.game), Math.max(0, Number(boundary) || 0));
    return prefix;
}

function carryManualState(oldStore, newStore) {
    for (const [id, oldRecord] of Object.entries(oldStore.entities || {})) {
        const current = newStore.entities[id];
        if (current) {
            current.pinned = oldRecord.pinned;
            current.enabled = oldRecord.enabled;
            if (oldRecord.manualOverride) {
                current.manualOverride = true;
                current.manualContent = oldRecord.manualContent;
            }
        } else if (oldRecord.manualOverride) {
            newStore.entities[id] = clone(oldRecord);
            newStore.entities[id].entryUid = null;
            newStore.entities[id].renderedHash = '';
        }
    }
    for (const [id, oldBrain] of Object.entries(oldStore.brains || {})) {
        const current = newStore.brains[id];
        if (current) {
            current.pinned = oldBrain.pinned;
            current.enabled = oldBrain.enabled;
        }
    }
}

// Capture a curator-fold checkpoint during normal play, but only once the head
// has advanced at least one lookback window past the newest checkpoint, so a
// long chat accumulates a bounded ladder rather than a checkpoint per turn.
function maybeRecordCheckpoint(store, settings = getSettings()) {
    if (!store || !Number.isInteger(store.lastProcessedIndex) || store.lastProcessedIndex < 0) return;
    const interval = Math.max(4, Number(settings?.lookbackMessages) || 10);
    const newest = (store.checkpoints || []).reduce(
        (max, checkpoint) => Math.max(max, Number.isInteger(checkpoint?.index) ? checkpoint.index : -1),
        -1,
    );
    if (store.lastProcessedIndex - newest < interval) return;
    store.checkpoints = recordCheckpoint(store.checkpoints, createStoreCheckpoint(store));
}

async function rebuildFromChat({ automatic = false } = {}) {
    const settings = getSettings();
    if (runtime.processing || runtime.rebuilding || runtime.preparingFoundation) {
        if (automatic) runtime.historyRebuildQueued = true;
        else toastr.warning('Stop or wait for the current InnerLore pass first.', DISPLAY_NAME);
        return;
    }
    const oldStore = getChatStore();
    const ctx = context();
    if (!oldStore) return;
    if (!automatic) {
        // An explicit rebuild starts a fresh retry episode.
        oldStore.lastError = '';
        oldStore.lastFailureAt = 0;
        oldStore.consecutiveFailures = 0;
        oldStore.nextRetryAt = 0;
    }
    if (automatic && ctx.chat.length > settings.autoRebuildMessageLimit) {
        oldStore.needsRebuild = true;
        await saveChatStore();
        setStatus('error', 'Rebuild needed', `History changed, but this chat has ${ctx.chat.length} messages (automatic limit: ${settings.autoRebuildMessageLimit}). Use Rebuild From Chat when convenient.`);
        updateUI();
        return;
    }

    const runChatId = currentChatId();
    const startingHistoryRevision = runtime.historyRevision;
    const completedHistoryIndex = lastCompletedStoryIndex(ctx.chat);

    // Phase 2 incremental resume: when an edit/swipe/delete only changed a
    // suffix of the chat, restore the newest checkpoint whose recorded history
    // still matches the chat and re-derive the curator fold (entities/brains)
    // from just after it, instead of replaying the whole conversation from an
    // empty store. Manual "Rebuild From Chat" always starts fresh. Only the
    // expensive per-batch curator fold is resumed; World Progression is rebuilt
    // fully in both paths (its runtime is not resumed mid-history yet).
    const divergenceIndex = firstDivergenceIndex(ctx.chat, oldStore.processedFingerprints || {});
    const resumeCheckpoint = automatic && Number.isFinite(divergenceIndex)
        ? selectResumeCheckpoint(oldStore.checkpoints, ctx.chat, divergenceIndex)
        : null;
    const temporary = createEmptyStore(runChatId);
    let rebuildStartIndex = 0;
    // A full replay starts from the same card-declared canon a new chat gets.
    // Checkpoints already carry the seeds they were captured with.
    if (!resumeCheckpoint) seedNewStoreFromCard(temporary);
    if (resumeCheckpoint) {
        applyStoreCheckpoint(temporary, resumeCheckpoint);
        temporary.checkpoints = (oldStore.checkpoints || [])
            .filter(checkpoint => Number.isInteger(checkpoint?.index) && checkpoint.index <= resumeCheckpoint.index);
        rebuildStartIndex = resumeCheckpoint.index + 1;
        setStatus('working', 'Rebuilding', `Resuming from message ${resumeCheckpoint.index}; re-deriving ${completedHistoryIndex - resumeCheckpoint.index} of ${ctx.chat.length} messages…`);
    }
    temporary.expressionFoundationVersion = 0;
    temporary.progression = createProgressionState();
    temporary.progression.eventDefinitions = Object.fromEntries(Object.entries(
        clone(normalizeProgressionState(oldStore.progression).eventDefinitions),
    ).filter(([, definition]) => definition.origin !== 'automatic_director'));
    // User-authored definitions are chat configuration, while generated
    // proposals and runtime are derived. If a deletion moved the end of history before an event's old
    // creation point, preserve it but re-arm it at the new end of history.
    for (const definition of Object.values(temporary.progression.eventDefinitions)) {
        if (definition.createdAtMessage > completedHistoryIndex) {
            definition.createdAtMessage = completedHistoryIndex;
            definition.createdAtElapsedSeconds = 0;
        }
    }
    temporary.progression = resetTriggerEventRuntime(temporary.progression, { replayCreationAnchors: true });
    temporary.lorebookName = oldStore.lorebookName;
    // The game journal rewinds exactly: everything recorded before the first
    // changed message stays, and the ledger re-reads only what follows. A
    // manual rebuild re-reads every reply but keeps the planner's prepared
    // places and the starting kit, which no reply produced.
    const oldGame = normalizeGameState(oldStore.game);
    temporary.game = automatic
        ? gameStateBefore(oldGame, Math.min(
            firstDivergenceIndex(ctx.chat, oldGame.processedFingerprints),
            completedHistoryIndex + 1,
        ))
        : gameStateBefore(oldGame, completedHistoryIndex + 1, { keepSources: ['planner', 'scene'] });
    const eventCreationBoundaries = new Set(Object.values(temporary.progression.eventDefinitions)
        .map(definition => definition.createdAtMessage)
        .filter(index => Number.isInteger(index) && index >= 0 && index <= completedHistoryIndex));
    runtime.rebuilding = true;
    runtime.historyRebuildQueued = false;
    runtime.controller = new AbortController();
    setStatus('working', 'Rebuilding', `Rebuilding ${ctx.chat.length} messages…`);
    try {
        let start = rebuildStartIndex;
        while (start <= completedHistoryIndex) {
            let end = completedRebuildBatchEnd(
                ctx.chat,
                start,
                completedHistoryIndex,
                settings.lookbackMessages,
            );
            if (end < start) break;
            const creationBoundary = [...eventCreationBoundaries]
                .filter(index => index >= start && index <= end)
                .sort((a, b) => a - b)[0];
            if (Number.isInteger(creationBoundary)) end = creationBoundary;
            setStatus('working', 'Rebuilding', `Rebuilding messages ${start}–${end} of ${ctx.chat.length - 1}…`);
            const result = await analyzeRange(temporary, start, end, {
                persist: false,
                sync: false,
                progressionMode: 'rebuild',
                progressionFlush: end === completedHistoryIndex || eventCreationBoundaries.has(end),
            });
            // A rebuild is one replacement transaction. Never publish a
            // partially reconstructed store when either background subsystem
            // failed; the quarantined prior store remains available for retry.
            throwForSubsystemFailure(result);
            if (currentChatId() !== runChatId) throw new DOMException('Chat changed', 'AbortError');
            start = end + 1;
            // Capture a checkpoint of the curator fold after each completed
            // batch so a later edit/swipe can resume from here instead of
            // replaying the whole chat.
            temporary.checkpoints = recordCheckpoint(temporary.checkpoints, createStoreCheckpoint(temporary));
        }

        const expectedProgressionIndex = completedHistoryIndex;
        while (settings.worldProgressionEnabled
            && !temporary.progression.lastError
            && temporary.progression.lastProcessedIndex < expectedProgressionIndex) {
            const before = temporary.progression.lastProcessedIndex;
            const result = await analyzeRange(temporary, before + 1, expectedProgressionIndex, {
                persist: false,
                sync: false,
                progressionMode: 'rebuild',
                progressionFlush: true,
                gameEnabled: false,
            });
            throwForSubsystemFailure(result);
            if (temporary.progression.lastProcessedIndex <= before) break;
        }
        const curatorEnabled = settings.innerSelfEnabled || settings.autoLoreEnabled;
        if (curatorEnabled && temporary.lastProcessedIndex < completedHistoryIndex) {
            throw new Error(`Continuity rebuild stopped at message ${temporary.lastProcessedIndex}; expected ${completedHistoryIndex}. The previous complete state was preserved.`);
        }
        if (settings.worldProgressionEnabled
            && normalizeProgressionState(temporary.progression).lastProcessedIndex < expectedProgressionIndex) {
            throw new Error(`World Progression rebuild stopped at message ${temporary.progression.lastProcessedIndex}; expected ${expectedProgressionIndex}. The previous complete state was preserved. ${temporary.progression.lastError || ''}`.trim());
        }

        carryManualState(oldStore, temporary);
        copyCardExpressionFoundation(temporary, oldStore, { copyCurrentMind: false });
        temporary.lorebookName = oldStore.lorebookName;
        temporary.lastProcessedIndex = completedHistoryIndex;
        temporary.assistantTurnsSincePass = 0;
        temporary.needsRebuild = false;
        // Record a final checkpoint at the completed head so the next edit can
        // resume from the very end of this rebuild.
        temporary.checkpoints = recordCheckpoint(temporary.checkpoints, createStoreCheckpoint(temporary));
        runtime.store = temporary;
        runtime.storeChatId = runChatId;
        const pointer = ctx.chatMetadata?.[MODULE_KEY];
        if (isInnerLoreStoragePointer(pointer)) attachTransientStoreFacade(pointer);
        // Cleanup must still run when automatic lore was disabled after an
        // earlier pass. Otherwise managed World Info entries from a discarded
        // swipe could remain active outside the metadata store.
        if (temporary.lorebookName || Object.keys(temporary.entities).length) {
            await syncLorebook(temporary, {
                chatId: runChatId,
                characterName: ctx.name2,
                removeMissing: true,
            });
        }
        // The rebuilt store deliberately replaces the quarantined one, so
        // dropping a discarded branch's entities is not a stale-store shrink.
        await saveChatStore({ allowEntityShrink: true });
        clearHistoryFallback();
        updateInjection();
        const progressionStats = getProgressionStats(temporary.progression);
        const detail = `Rebuilt ${Object.keys(temporary.entities).length} lore entries, ${Object.keys(temporary.brains).length} character minds, and ${progressionStats.goals + progressionStats.processes + progressionStats.events} progression records from ${ctx.chat.length} messages. Story clock: ${progressionStats.clock}.`;
        setStatus('success', 'Rebuilt', detail);
        if (!automatic) toastr.success(detail, DISPLAY_NAME, { timeOut: 4_000 });
    } catch (error) {
        if (error?.name === 'AbortError' || runtime.controller?.signal.aborted) {
            setStatus('idle', 'Stopped', 'Rebuild stopped; the previous complete state is still intact.');
        } else if (error?.name === 'InnerLoreHistoryChangedError') {
            oldStore.needsRebuild = true;
            runtime.historyRebuildQueued = true;
            await saveChatStore();
            setStatus('working', 'Rebuild queued', 'History changed again during rebuilding; retrying from a clean snapshot.');
        } else {
            console.error(LOG_PREFIX, 'Rebuild failed:', error);
            oldStore.needsRebuild = true;
            oldStore.lastError = cleanString(error.message || String(error), 2_000);
            oldStore.lastFailureAt = Date.now();
            oldStore.consecutiveFailures = Math.max(0, Number(oldStore.consecutiveFailures) || 0) + 1;
            // A resumed rebuild that failed for a non-transient reason may be
            // sitting on an unusable checkpoint. Drop the ladder so the retry
            // degrades to a clean full rebuild instead of looping on it.
            if (resumeCheckpoint && !isTransientRequestError(error)) oldStore.checkpoints = [];
            const retryDelays = [5_000, 15_000, 45_000];
            const retryDelay = isTransientRequestError(error)
                ? retryDelays[oldStore.consecutiveFailures - 1] || 0
                : 0;
            if (retryDelay) {
                oldStore.nextRetryAt = Date.now() + retryDelay;
                runtime.historyRebuildQueued = true;
                setStatus(
                    'working',
                    'Rebuild retry scheduled',
                    `${oldStore.lastError} Restarting the clean rebuild in ${Math.round(retryDelay / 1_000)} seconds.`,
                );
            } else {
                oldStore.nextRetryAt = 0;
                setStatus('error', 'Rebuild failed', oldStore.lastError);
                if (!automatic) toastr.error(oldStore.lastError, DISPLAY_NAME, { timeOut: 8_000 });
            }
            await saveChatStore();
        }
    } finally {
        runtime.rebuilding = false;
        runtime.controller = null;
        updateUI();
        if (currentChatId() === runChatId
            && (runtime.historyRebuildQueued || runtime.historyRevision > startingHistoryRevision)) {
            runtime.historyRebuildQueued = true;
            scheduleQueuedHistoryRebuild(250);
        }
    }
}

function scheduleQueuedHistoryRebuild(delay = 2_500) {
    clearTimeout(runtime.historyTimer);
    runtime.historyTimer = setTimeout(() => {
        runtime.historyTimer = null;
        void runQueuedHistoryRebuild();
    }, Math.max(0, delay));
}

async function runQueuedHistoryRebuild() {
    const settings = getSettings();
    const store = getChatStore();
    if (!store?.needsRebuild) {
        runtime.historyRebuildQueued = false;
        clearHistoryFallback();
        return;
    }
    if (!settings.enabled || !settings.autoRebuildOnHistoryChange) {
        runtime.historyRebuildQueued = false;
        return;
    }
    if (runtime.processing || runtime.rebuilding || runtime.preparingFoundation) {
        runtime.historyRebuildQueued = true;
        return;
    }
    if (runtime.deferHistoryRebuild || deferWhileStoryWrites('history', () => runQueuedHistoryRebuild())) {
        runtime.historyRebuildQueued = true;
        return;
    }
    const retryWait = Math.max(0, Number(store.nextRetryAt) - Date.now());
    if (retryWait > 0) {
        runtime.historyRebuildQueued = true;
        scheduleQueuedHistoryRebuild(Math.max(250, retryWait));
        return;
    }
    runtime.historyRebuildQueued = false;
    await rebuildFromChat({ automatic: true });
}

function scheduleHistoryRebuild(options = {}) {
    const settings = getSettings();
    const store = getChatStore();
    if (!store) return;
    if (Number.isInteger(options.promptFallbackIndex)) {
        runtime.historyFallbackStore = historyPrefixStore(store, options.promptFallbackIndex);
        runtime.historyFallbackChatId = currentChatId();
        runtime.historyFallbackBoundary = options.promptFallbackIndex;
    }
    store.needsRebuild = true;
    store.lastError = '';
    store.lastFailureAt = 0;
    store.consecutiveFailures = 0;
    store.nextRetryAt = 0;
    runtime.historyRevision++;
    runtime.historyRebuildQueued = true;
    void saveChatStore().catch(error => {
        console.error(`${LOG_PREFIX} Could not persist the rebuild quarantine:`, error);
    });
    updateInjection();
    if (!settings.enabled || !settings.autoRebuildOnHistoryChange) {
        runtime.historyRebuildQueued = false;
        setStatus('error', 'Rebuild needed', 'A message was edited, swiped, or deleted. Use Rebuild From Chat to remove discarded-branch state.');
        updateUI();
        return;
    }
    setStatus('working', 'Rebuild queued', 'History changed; stale InnerLore state is quarantined until rebuilding completes.');
    scheduleQueuedHistoryRebuild();
    updateUI();
}

const FOUNDATION_OUTER_VOICE_KINDS = new Set([
    'cadence',
    'hesitation',
    'emotional_openness',
    'pressure_shift',
]);

function cardBackedEntries(entries) {
    return Object.fromEntries(Object.entries(entries || {}).filter(([, entry]) => (
        entry?.basis === 'character_card'
    )));
}

function hasStructuredExpressionFoundation(brain) {
    const facets = Object.values(brain?.persistentSelf?.facets || {})
        .filter(entry => entry?.basis === 'character_card');
    const voice = Object.values(brain?.persistentSelf?.voice || {})
        .filter(entry => entry?.basis === 'character_card');
    return facets.some(entry => entry.kind === 'personal_anchor')
        && voice.some(entry => entry.kind === 'thought_style')
        && voice.some(entry => entry.kind === 'emphasis')
        && voice.some(entry => FOUNDATION_OUTER_VOICE_KINDS.has(entry.kind));
}

function structuredFoundationBrains(store) {
    return Object.values(store?.brains || {}).filter(brain => (
        brain?.active !== false && hasStructuredExpressionFoundation(brain)
    ));
}

function expressionFoundationReady(store) {
    return Number(store?.expressionFoundationVersion) >= EXPRESSION_FOUNDATION_VERSION;
}

/**
 * Persist only character-card-backed psychology from the preflight.  These
 * fields are safe across swipes; transient mind state and story-derived
 * beliefs remain in the branch-local staging view until the full rebuild.
 */
function copyCardExpressionFoundation(destination, source, options = {}) {
    if (!destination || !source) return 0;
    const copyCurrentMind = options.copyCurrentMind ?? !destination.needsRebuild;
    let copied = 0;
    destination.brains = destination.brains && typeof destination.brains === 'object'
        ? destination.brains
        : {};
    for (const sourceBrain of structuredFoundationBrains(source)) {
        const id = sourceBrain.id || canonicalNameKey(sourceBrain.name);
        if (!id) continue;
        const sourceFacets = cardBackedEntries(sourceBrain.persistentSelf?.facets);
        const sourceVoice = cardBackedEntries(sourceBrain.persistentSelf?.voice);
        const sourceRelationships = Object.fromEntries(
            Object.entries(sourceBrain.persistentSelf?.relationships || {}).flatMap(([relationshipId, relationship]) => {
                const aspects = cardBackedEntries(relationship?.aspects);
                return Object.keys(aspects).length
                    ? [[relationshipId, { ...clone(relationship), aspects }]]
                    : [];
            }),
        );
        let target = destination.brains[id];
        if (!target) {
            target = clone(sourceBrain);
            target.currentMind = copyCurrentMind ? clone(sourceBrain.currentMind) : null;
            target.persistentSelf = {
                facets: sourceFacets,
                voice: sourceVoice,
                relationships: sourceRelationships,
            };
            destination.brains[id] = target;
        } else {
            target.persistentSelf = target.persistentSelf && typeof target.persistentSelf === 'object'
                ? target.persistentSelf
                : { facets: {}, voice: {}, relationships: {} };
            target.persistentSelf.facets = {
                ...(target.persistentSelf.facets || {}),
                ...clone(sourceFacets),
            };
            target.persistentSelf.voice = {
                ...(target.persistentSelf.voice || {}),
                ...clone(sourceVoice),
            };
            target.persistentSelf.relationships = target.persistentSelf.relationships || {};
            for (const [relationshipId, relationship] of Object.entries(sourceRelationships)) {
                const current = target.persistentSelf.relationships[relationshipId];
                target.persistentSelf.relationships[relationshipId] = current
                    ? {
                        ...current,
                        aspects: { ...(current.aspects || {}), ...clone(relationship.aspects) },
                    }
                    : clone(relationship);
            }
            if (copyCurrentMind && sourceBrain.currentMind) {
                target.currentMind = clone(sourceBrain.currentMind);
            }
            target.updatedAt = Date.now();
        }
        copied++;
    }
    if (copied) {
        destination.expressionFoundationVersion = EXPRESSION_FOUNDATION_VERSION;
        destination.updatedAt = Date.now();
    }
    return copied;
}

async function waitForInnerLorePassToStop(maximumMilliseconds = 5_000) {
    const deadline = Date.now() + Math.max(250, maximumMilliseconds);
    while (runtime.processing || runtime.rebuilding || runtime.preparingFoundation) {
        runtime.controller?.abort();
        if (Date.now() >= deadline) return false;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    return true;
}

async function prepareExpressionFoundation(targetStore, boundary) {
    const settings = getSettings();
    const ctx = context();
    const runChatId = currentChatId();
    const endIndex = Math.min(ctx.chat.length - 1, Math.max(-1, Number(boundary) - 1));
    if (endIndex < 0) throw new Error('There is no character-card greeting or story passage from which to prepare an NPC mind.');
    const startIndex = Math.max(0, endIndex - Math.max(8, Number(settings.lookbackMessages) || 10) + 1);
    const transcript = formatTranscript(ctx.chat, {
        startIndex,
        endIndex,
        userName: ctx.name1,
        characterName: ctx.name2,
        maximumCharacters: 55_000,
    });
    if (!transcript) throw new Error('The selected branch contains no usable narrative text for the NPC foundation pass.');

    runtime.preparingFoundation = true;
    runtime.controller = new AbortController();
    setStatus('working', 'Preparing NPC minds', 'Building the real structured expression foundation before the story request…');
    updateUI();
    try {
        const foundationSettings = {
            ...settings,
            autoLoreEnabled: false,
            maximumEntitiesPerPass: 1,
            // Retry the same selected route once for a transient transport
            // fault. This is not a provider/model fallback, and the bounded
            // per-attempt ceiling prevents another indefinite swipe spinner.
            requestMaximumAttempts: 2,
            requestTimeoutSeconds: Math.min(180, Math.max(15, Number(settings.requestTimeoutSeconds) || 60)),
        };
        const response = await requestJsonPatch(foundationSettings, buildAnalysisMessages({
            transcript,
            store: targetStore,
            currentIndex: endIndex,
            characterCard: getCardContext(),
            playerName: ctx.name1,
            recentExpressionText: collectRecentStoryExpressions(ctx.chat, {
                endIndex,
                maximumReplies: 3,
                maximumCharacters: 1_600,
            }),
            settings: foundationSettings,
            foundationOnly: true,
        }), runtime.controller.signal);
        if (currentChatId() !== runChatId) throw new DOMException('Chat changed', 'AbortError');
        const payload = response?.payload && typeof response.payload === 'object' ? response.payload : {};
        const playerKey = canonicalNameKey(ctx.name1);
        const mindOperations = (payload.minds || payload.mind_operations || [])
            .filter(operation => !playerKey || canonicalNameKey(operation?.character) !== playerKey);
        mergeMindOperations(targetStore, mindOperations, {
            maximumOperations: settings.maximumMindOperationsPerPass,
            maximumThoughts: settings.maximumThoughtsPerBrain,
            maximumThoughtChanges: settings.maximumThoughtChangesPerBrain,
            maximumSceneThoughts: settings.maximumSceneThoughtsPerBrain,
            messageIndex: endIndex,
        });
        const readyBrains = structuredFoundationBrains(targetStore);
        if (!readyBrains.length) {
            throw new Error('The curator returned no NPC with a complete personal anchor, thought voice, outward voice, and emphasis policy.');
        }
        targetStore.expressionFoundationVersion = EXPRESSION_FOUNDATION_VERSION;
        targetStore.updatedAt = Date.now();
        const destination = getChatStore();
        const copied = copyCardExpressionFoundation(destination, targetStore);
        if (!copied) throw new Error('The curator response contained no branch-safe character-card expression foundation.');
        await saveChatStore();
        setStatus('success', 'NPC minds ready', `Prepared structured expression foundations for ${readyBrains.map(brain => brain.name).join(', ')}.`);
        return targetStore;
    } finally {
        runtime.preparingFoundation = false;
        runtime.controller = null;
        updateUI();
    }
}

function beginExpressionFoundation(targetStore, boundary) {
    const chatId = currentChatId();
    if (runtime.foundationPromise && runtime.foundationChatId === chatId) {
        return runtime.foundationPromise;
    }
    const rawPromise = prepareExpressionFoundation(targetStore, boundary);
    const trackedPromise = rawPromise.finally(() => {
        if (runtime.foundationPromise !== trackedPromise) return;
        runtime.foundationPromise = null;
        runtime.foundationChatId = '';
    });
    runtime.foundationPromise = trackedPromise;
    runtime.foundationChatId = chatId;
    return trackedPromise;
}

function scheduleExpressionFoundationWarmup(delay = 250) {
    clearTimeout(runtime.foundationTimer);
    runtime.foundationTimer = setTimeout(() => {
        runtime.foundationTimer = null;
        void runExpressionFoundationWarmup();
    }, Math.max(0, delay));
}

async function runExpressionFoundationWarmup() {
    const settings = getSettings();
    const store = getChatStore();
    if (!settings.enabled || !settings.innerSelfEnabled || !store || expressionFoundationReady(store)) return;
    if (store.needsRebuild) {
        runtime.historyRebuildQueued = true;
        scheduleQueuedHistoryRebuild(0);
        return;
    }
    if (runtime.processing || runtime.rebuilding) {
        scheduleExpressionFoundationWarmup(500);
        return;
    }
    if (deferWhileStoryWrites('foundation', () => scheduleExpressionFoundationWarmup(0))) return;
    const boundary = context().chat.length;
    const staging = historyPrefixStore(store, boundary);
    try {
        await beginExpressionFoundation(staging, boundary);
        updateInjection();
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error(LOG_PREFIX, 'Expression warm-up failed:', error);
        store.lastError = cleanString(error.message || String(error), 2_000);
        store.lastFailureAt = Date.now();
        await saveChatStore();
        setStatus('error', 'NPC mind warm-up failed', `${store.lastError} The next story request will retry without using a fallback.`);
        updateUI();
    }
}

function blockStoryGeneration(error) {
    const detail = cleanString(error?.message || String(error), 2_000) || 'Unknown InnerLore foundation error.';
    runtime.storyGenerationBlock = {
        chatId: currentChatId(),
        detail,
        at: Date.now(),
    };
    setStatus('error', 'Story cancelled', `${detail} No fallback prompt was sent to the narrator.`);
    toastr.error(`${detail} The story request was cancelled; no fallback was used. Retry after the InnerLore provider recovers.`, DISPLAY_NAME, {
        timeOut: 12_000,
        extendedTimeOut: 20_000,
        preventDuplicates: true,
    });
}

function stopCurrentPass() {
    runtime.controller?.abort();
}

async function saveSelectedEntity() {
    const store = getChatStore();
    const record = store?.entities?.[runtime.selectedEntityId];
    if (!record) return;
    record.aliases = parseCommaList(document.getElementById('il_entity_aliases')?.value);
    record.keys = parseCommaList(document.getElementById('il_entity_keys')?.value);
    record.importance = Math.max(0, Math.min(100, Number(document.getElementById('il_entity_importance')?.value) || 0));
    record.enabled = Boolean(document.getElementById('il_entity_enabled')?.checked);
    record.pinned = Boolean(document.getElementById('il_entity_pinned')?.checked);
    const editedContent = cleanString(document.getElementById('il_entity_content')?.value, 20_000);
    const automaticContent = renderLoreContent({ ...record, manualOverride: false, manualContent: '' });
    record.manualOverride = Boolean(editedContent && editedContent !== automaticContent);
    record.manualContent = record.manualOverride ? editedContent : '';
    record.updatedAt = Date.now();
    await syncLorebook(store, { chatId: store.chatId, characterName: context().name2 });
    await saveChatStore();
    updateUI();
    toastr.success(`Saved ${record.name}.`, DISPLAY_NAME);
}

async function restoreSelectedEntityAutomation() {
    const store = getChatStore();
    const record = store?.entities?.[runtime.selectedEntityId];
    if (!record) return;
    record.manualOverride = false;
    record.manualContent = '';
    await syncLorebook(store, { chatId: store.chatId, characterName: context().name2 });
    await saveChatStore();
    renderEntityEditor();
    toastr.success(`${record.name} will use automatic content again.`, DISPLAY_NAME);
}

async function deleteSelectedEntity() {
    const store = getChatStore();
    const record = store?.entities?.[runtime.selectedEntityId];
    if (!record || !confirm(`Delete the generated lore entry for ${record.name}?`)) return;
    await removeLoreRecord(store, record.id);
    rememberLorebook(store);
    runtime.selectedEntityId = '';
    await saveChatStore();
    updateUI();
}

function parsedBrainPsychology(value, brain, aliases) {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Brain JSON must be an object with persistent_self, voice, relationships, and current_mind fields.');
    }
    const relationships = Object.fromEntries(Object.entries(parsed.relationships || {}).map(([target, relationship]) => [
        target,
        {
            target,
            aliases: relationship?.aliases || [],
            aspects: relationship?.aspects || {},
        },
    ]));
    const normalized = normalizeBrainRecord({
        ...brain,
        aliases,
        thoughts: undefined,
        persistentSelf: {
            facets: parsed.persistent_self || {},
            voice: parsed.voice || {},
            relationships,
        },
        currentMind: parsed.current_mind ?? null,
    }, brain.name);
    if (!normalized) throw new Error('The brain JSON did not contain valid psychological state.');
    if (normalized.currentMind && normalized.currentMind.sourceMessage < 0) {
        normalized.currentMind.sourceMessage = context().chat.length - 1;
        normalized.currentMind.updatedAt = Date.now();
    }
    return normalized;
}

async function saveSelectedBrain() {
    const store = getChatStore();
    const brain = store?.brains?.[runtime.selectedBrainId];
    if (!brain) return;
    try {
        const updated = parsedBrainPsychology(
            document.getElementById('il_brain_json')?.value,
            brain,
            parseCommaList(document.getElementById('il_brain_aliases')?.value),
        );
        updated.enabled = Boolean(document.getElementById('il_brain_enabled')?.checked);
        updated.pinned = Boolean(document.getElementById('il_brain_pinned')?.checked);
        updated.updatedAt = Date.now();
        updated.revision = Math.max(0, Number(updated.revision) || 0) + 1;
        store.brains[updated.id] = updated;
        runtime.brainJsonDirty = false;
        await saveChatStore();
        updateUI();
        renderBrainEditor();
        toastr.success(`Saved ${brain.name}'s mind.`, DISPLAY_NAME);
    } catch (error) {
        toastr.error(error.message || String(error), DISPLAY_NAME);
    }
}

async function addBrain() {
    const nameInput = document.getElementById('il_new_brain_name');
    const name = cleanString(nameInput?.value, 160);
    const store = getChatStore();
    if (!store || !name) return;
    const id = canonicalNameKey(name);
    if (!store.brains[id]) {
        mergeMindOperations(store, [{
            character: name,
            active: true,
            persistent_self: { set: [{
                key: 'identity_anchor',
                kind: 'self_concept',
                statement: `I am ${name}.`,
                confidence: 'confirmed',
            }] },
        }], { messageIndex: context().chat.length - 1, maximumThoughts: getSettings().maximumThoughtsPerBrain });
    }
    runtime.selectedBrainId = id;
    if (nameInput) nameInput.value = '';
    await saveChatStore();
    updateUI();
}

async function deleteSelectedBrain() {
    const store = getChatStore();
    const brain = store?.brains?.[runtime.selectedBrainId];
    if (!brain || !confirm(`Delete ${brain.name}'s private mind?`)) return;
    delete store.brains[runtime.selectedBrainId];
    runtime.selectedBrainId = '';
    await saveChatStore();
    updateUI();
}

function triggerEventEditorValue(id) {
    return cleanString(document.getElementById(id)?.value, 4_000);
}

async function addTriggerEvent() {
    let store = getChatStore();
    if (!store) {
        // The store loads asynchronously after a chat opens; brief wait beats
        // an instant "no store" error for a store that is seconds away.
        for (let i = 0; i < 20 && !store; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            store = getChatStore();
        }
    }
    const titleInput = document.getElementById('il_new_trigger_event_title');
    const title = cleanString(titleInput?.value, 240);
    if (!store) return toastr.error('The InnerLore store for this chat is not available yet. Wait a moment for it to load, or reopen the chat.', DISPLAY_NAME);
    if (!title) return toastr.error('Enter an event title first.', DISPLAY_NAME);
    try {
        const state = normalizeProgressionState(store.progression);
        const id = `trigger:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const result = upsertTriggerEventDefinition(state, {
            id,
            title,
            key: title,
            enabled: false,
            description: '',
            triggerAfterSeconds: null,
            actionCondition: '',
            activationVisibility: 'observable',
            priority: 70,
        }, {
            clock: state.clock,
            messageIndex: lastCompletedStoryIndex(context().chat),
            playerName: context().name1,
        });
        store.progression = result.state;
        runtime.selectedTriggerEventId = result.definition.id;
        if (titleInput) titleInput.value = '';
        await saveChatStore();
        updateUI();
        toastr.info('Disabled draft created. Its name is only a label—configure a time or action trigger, enable it, then press Save & Arm Event.', DISPLAY_NAME, { timeOut: 8_000 });
    } catch (error) {
        toastr.error(error.message || String(error), DISPLAY_NAME);
    }
}

async function saveSelectedTriggerEvent() {
    const store = getChatStore();
    const existing = currentTriggerEventRecord();
    if (!store || !existing) return;
    try {
        // An enabled event without any trigger is a silent dead end: it is
        // excluded from evaluator requests and can never fire. Refuse it here
        // instead of letting a half-configured event look armed.
        const wantsEnabled = Boolean(document.getElementById('il_trigger_event_enabled')?.checked);
        const hasTimeTrigger = Boolean(readOptionalDuration('il_trigger_event_time_amount', 'il_trigger_event_time_unit'));
        const hasActionTrigger = Boolean(triggerEventEditorValue('il_trigger_event_action').trim());
        if (wantsEnabled && !hasTimeTrigger && !hasActionTrigger) {
            return toastr.error('This event has no trigger yet. Set a time trigger or an action trigger before enabling it.', DISPLAY_NAME);
        }
        const state = normalizeProgressionState(store.progression);
        const result = upsertTriggerEventDefinition(state, {
            id: existing.id,
            key: triggerEventEditorValue('il_trigger_event_key'),
            title: triggerEventEditorValue('il_trigger_event_title'),
            description: triggerEventEditorValue('il_trigger_event_description'),
            enabled: Boolean(document.getElementById('il_trigger_event_enabled')?.checked),
            priority: Number(document.getElementById('il_trigger_event_priority')?.value),
            triggerMode: document.getElementById('il_trigger_event_mode')?.value,
            timeBasis: document.getElementById('il_trigger_event_time_basis')?.value,
            triggerAfterSeconds: readOptionalDuration('il_trigger_event_time_amount', 'il_trigger_event_time_unit'),
            triggerTimeCertainty: document.getElementById('il_trigger_event_time_certainty')?.value,
            actorScope: document.getElementById('il_trigger_event_actor_scope')?.value,
            actorName: triggerEventEditorValue('il_trigger_event_actor_name'),
            actionCondition: triggerEventEditorValue('il_trigger_event_action'),
            actionTiming: document.getElementById('il_trigger_event_action_timing')?.value,
            cancellationCondition: triggerEventEditorValue('il_trigger_event_cancel'),
            activationVisibility: document.getElementById('il_trigger_event_visibility')?.value,
            revealAfterSeconds: readOptionalDuration('il_trigger_event_reveal_amount', 'il_trigger_event_reveal_unit'),
            revealCondition: triggerEventEditorValue('il_trigger_event_reveal_condition'),
            resolutionCondition: triggerEventEditorValue('il_trigger_event_resolution'),
            consequences: triggerEventEditorValue('il_trigger_event_consequences'),
            subjects: parseCommaList(document.getElementById('il_trigger_event_subjects')?.value),
        }, {
            clock: state.clock,
            messageIndex: lastCompletedStoryIndex(context().chat),
            playerName: context().name1,
        });
        store.progression = result.state;
        // A disabled save must never keep a stale armed runtime status —
        // otherwise the list shows ARMED while the evaluator ignores it.
        if (!result.definition.enabled) {
            const runtimeState = store.progression.eventRuntime?.[result.definition.id];
            if (runtimeState && runtimeState.status !== 'draft') runtimeState.status = 'draft';
        }
        runtime.selectedTriggerEventId = result.definition.id;
        await saveChatStore();
        updateUI();
        if (result.definition.enabled) {
            toastr.success(result.rearmed
                ? 'Event saved and armed from the current story point.'
                : 'Enabled event saved.', DISPLAY_NAME);
        } else {
            toastr.info('Draft saved, but it remains disabled and cannot trigger.', DISPLAY_NAME);
        }
    } catch (error) {
        toastr.error(error.message || String(error), DISPLAY_NAME);
    }
}

async function rearmSelectedTriggerEvent() {
    const store = getChatStore();
    const existing = currentTriggerEventRecord();
    if (!store || !existing) return;
    try {
        const state = normalizeProgressionState(store.progression);
        const result = rearmTriggerEvent(state, existing.id, {
            clock: state.clock,
            messageIndex: lastCompletedStoryIndex(context().chat),
            resetCreationAnchor: true,
        });
        store.progression = result.state;
        await saveChatStore();
        updateUI();
        toastr.success(`${result.definition.title} is armed again from the current story point.`, DISPLAY_NAME);
    } catch (error) {
        toastr.error(error.message || String(error), DISPLAY_NAME);
    }
}

async function retrySelectedTriggerEventDelivery() {
    const store = getChatStore();
    const existing = currentTriggerEventRecord();
    if (!store || !existing) return;
    try {
        const result = retryTriggerEventDelivery(normalizeProgressionState(store.progression), existing.id);
        store.progression = result.state;
        await saveChatStore();
        runtime.lastTriggerDeliveryPrompt = '';
        updateTriggerDeliveryPrompt();
        updateUI();
        toastr.success(`${result.definition.title} will be sent again with the next story generation.`, DISPLAY_NAME);
    } catch (error) {
        toastr.error(error.message || String(error), DISPLAY_NAME);
    }
}

async function deleteSelectedTriggerEvent() {
    const store = getChatStore();
    const existing = currentTriggerEventRecord();
    if (!store || !existing || !confirm(`Delete the triggerable event “${existing.title}”?`)) return;
    const result = removeTriggerEventDefinition(normalizeProgressionState(store.progression), existing.id);
    store.progression = result.state;
    if (existing.origin === 'automatic_director' && existing.proposalId
        && store.progression.eventProposals?.[existing.proposalId]) {
        store.progression.eventProposals[existing.proposalId].status = 'superseded';
        store.progression.eventProposals[existing.proposalId].rejectionReason = 'generated_definition_deleted';
        store.progression.eventProposals[existing.proposalId].updatedAt = Date.now();
    }
    runtime.selectedTriggerEventId = '';
    await saveChatStore();
    updateUI();
    toastr.success('Triggerable event deleted.', DISPLAY_NAME);
}

async function approveSelectedEventProposal() {
    const store = getChatStore();
    const proposal = currentEventProposal();
    if (!store || !proposal || proposal.status !== 'proposed') return;
    try {
        const currentMessageIndex = lastCompletedStoryIndex(context().chat);
        let progression = normalizeProgressionState(clone(store.progression));
        const expiration = expireAutomaticEventState(progression, narrativeBranchDescriptor().id, currentMessageIndex);
        progression = expiration.state;
        const current = progression.eventProposals?.[proposal.id];
        if (!current || current.status !== 'proposed') throw new Error('This proposal is no longer eligible to be armed.');
        const armed = upsertTriggerEventDefinition(progression, eventDefinitionFromProposal(current), {
            clock: progression.clock,
            messageIndex: currentMessageIndex,
            playerName: context().name1,
        });
        progression = markEventProposalArmed(armed.state, current.id, armed.definition.id).state;
        await persistProgressionReplacement(store, progression);
        runtime.selectedTriggerEventId = armed.definition.id;
        updateUI();
        toastr.success(`Armed “${armed.definition.title}” from the current story point.`, DISPLAY_NAME);
    } catch (error) {
        toastr.error(error.message || String(error), DISPLAY_NAME);
    }
}

async function rejectSelectedEventProposal() {
    const store = getChatStore();
    const proposal = currentEventProposal();
    if (!store || !proposal || proposal.status !== 'proposed') return;
    try {
        const progression = rejectEventProposal(
            normalizeProgressionState(clone(store.progression)),
            proposal.id,
            'Rejected by user in the InnerLore proposal review.',
        ).state;
        await persistProgressionReplacement(store, progression);
        updateUI();
        toastr.info(`Rejected “${proposal.title}”.`, DISPLAY_NAME);
    } catch (error) {
        toastr.error(error.message || String(error), DISPLAY_NAME);
    }
}

async function deleteSelectedEventProposal() {
    const store = getChatStore();
    const proposal = currentEventProposal();
    if (!store || !proposal || !confirm(`Delete the Event Director proposal “${proposal.title}”?`)) return;
    try {
        let progression = normalizeProgressionState(clone(store.progression));
        if (proposal.definitionId && progression.eventDefinitions?.[proposal.definitionId]?.origin === 'automatic_director') {
            progression = removeTriggerEventDefinition(progression, proposal.definitionId).state;
        }
        progression = removeEventProposal(progression, proposal.id).state;
        await persistProgressionReplacement(store, progression);
        runtime.selectedEventProposalId = '';
        updateUI();
        toastr.success('Automatic event proposal deleted.', DISPLAY_NAME);
    } catch (error) {
        toastr.error(error.message || String(error), DISPLAY_NAME);
    }
}

async function generateAutomaticEventNow() {
    if (runtime.processing || runtime.rebuilding || runtime.preparingFoundation) {
        toastr.warning('Wait for the current InnerLore pass to finish first.', DISPLAY_NAME);
        return;
    }
    if (!getSettings().automaticEventDirectorEnabled) {
        toastr.warning('Enable Automatic Event Director first.', DISPLAY_NAME);
        return;
    }
    runtime.processing = true;
    runtime.controller = new AbortController();
    setStatus('working', 'Directing', 'Building a grounded event candidate from committed state…');
    try {
        const result = await maybeRunAutomaticEventDirector({ force: true });
        updateUI();
        if (result.generated) {
            const action = result.definition ? 'generated, validated, and armed' : 'generated and saved for review';
            setStatus('success', 'Event ready', `“${result.proposal.title}” was ${action}.`);
            toastr.success(`“${result.proposal.title}” was ${action}.`, DISPLAY_NAME);
        } else if (result.error) {
            setStatus('error', 'Director deferred', result.error.message || String(result.error));
            toastr.error(result.error.message || String(result.error), DISPLAY_NAME);
        } else {
            setStatus('success', 'No event needed', result.reason || 'The model found no grounded event worth adding.');
            toastr.info(result.reason || 'No grounded event was proposed.', DISPLAY_NAME);
        }
    } catch (error) {
        if (error?.name === 'AbortError') setStatus('idle', 'Stopped', 'Event generation was stopped.');
        else {
            setStatus('error', 'Director failed', error.message || String(error));
            toastr.error(error.message || String(error), DISPLAY_NAME);
        }
    } finally {
        runtime.processing = false;
        runtime.controller = null;
        updateUI();
    }
}

async function resetGameState() {
    const store = getChatStore();
    if (!store) return;
    if (!confirm('Reset this chat\'s money, belongings, prices, standing, reputation and prepared places? The story itself is not changed.')) return;
    store.game = createGameState();
    // Start reading from now rather than replaying the whole chat.
    store.game.lastProcessedIndex = lastCompletedStoryIndex(context().chat);
    store.game.introducedThrough = store.game.lastProcessedIndex;
    await saveChatStore();
    updateInjection();
    updateUI();
    toastr.success('Game state reset. The ledger starts again from the next reply.', DISPLAY_NAME);
}

async function resetWorldProgression() {
    const store = getChatStore();
    if (!store || !confirm('Reset the private World Progression clock, goals, processes, and automatic beats for this chat? User-authored events will be preserved and re-armed; generated proposals will be discarded and can be derived again. Public lore and character minds are not changed.')) return;
    const previous = normalizeProgressionState(store.progression);
    const currentIndex = lastCompletedStoryIndex(context().chat);
    store.progression = createProgressionState();
    store.progression.eventDefinitions = Object.fromEntries(Object.entries(clone(previous.eventDefinitions))
        .filter(([, definition]) => definition.origin !== 'automatic_director'));
    for (const definition of Object.values(store.progression.eventDefinitions)) {
        definition.createdAtElapsedSeconds = 0;
        definition.createdAtMessage = currentIndex;
        definition.revision = Math.max(1, Number(definition.revision) || 1) + 1;
        definition.updatedAt = Date.now();
    }
    store.progression = resetTriggerEventRuntime(store.progression);
    store.progression.lastProcessedIndex = currentIndex;
    await saveChatStore();
    runtime.lastInjection = '';
    updateUI();
    toastr.success('World Progression reset. User-authored events were preserved and re-armed; generated events were cleared.', DISPLAY_NAME);
}

function bindCheckbox(id, key, after = null) {
    document.getElementById(id)?.addEventListener('change', event => {
        const value = Boolean(event.target.checked);
        getSettings()[key] = value;
        saveSettings();
        after?.(value);
    });
}

function bindNumber(id, key, minimum, maximum, after = null) {
    document.getElementById(id)?.addEventListener('change', event => {
        const value = Math.min(maximum, Math.max(minimum, Number(event.target.value) || minimum));
        getSettings()[key] = value;
        event.target.value = value;
        saveSettings();
        after?.();
    });
}

function bindSelect(id, key, allowed, after = null) {
    document.getElementById(id)?.addEventListener('change', event => {
        if (!allowed.includes(event.target.value)) return;
        getSettings()[key] = event.target.value;
        saveSettings();
        after?.();
    });
}

function bindUIEvents() {
    bindCheckbox('il_enabled', 'enabled', updateUI);
    bindCheckbox('il_auto_update', 'autoUpdate');
    bindCheckbox('il_auto_recover_incomplete', 'autoRecoverIncomplete');
    bindNumber('il_incomplete_recovery_attempts', 'incompleteRecoveryAttempts', 1, 3);
    bindCheckbox('il_inner_self_enabled', 'innerSelfEnabled', enabled => {
        updateUI();
        refreshContextAfterConfigurationChange();
        if (!enabled) return;
        const store = getChatStore();
        if (!store) return;
        clearAnalysisRetry();
        // Re-enabling a subsystem is a new retry episode. Without this reset,
        // a provider error that happened while it was previously enabled can
        // leave the newly enabled brain waiting for another story turn.
        store.consecutiveFailures = 0;
        store.nextRetryAt = 0;
        context().saveMetadataDebounced?.();
        if (getSettings().autoUpdate && pendingAnalysisState(store).pending) {
            setTimeout(() => processPending({ force: true, silent: true }), 250);
        }
    });
    bindCheckbox('il_auto_lore_enabled', 'autoLoreEnabled', () => {
        updateUI();
        refreshContextAfterConfigurationChange();
    });
    bindCheckbox('il_world_progression_enabled', 'worldProgressionEnabled', () => {
        updateUI();
        refreshContextAfterConfigurationChange();
    });
    bindSelect('il_maintenance_output_format', 'maintenanceOutputFormat', ['json', 'dsl']);
    bindCheckbox('il_repair_json', 'repairMalformedJson');
    bindCheckbox('il_auto_rebuild_history', 'autoRebuildOnHistoryChange');
    bindCheckbox('il_debug', 'debug');
    bindNumber('il_maximum_response_tokens', 'maximumResponseTokens', 800, 32_000);
    bindNumber('il_temperature', 'temperature', 0, 1.5);
    document.getElementById('il_storage_backend')?.addEventListener('change', event => {
        const value = ['embedded', 'sqlite'].includes(event.target.value) ? event.target.value : 'embedded';
        getSettings().storageBackend = value;
        saveSettings();
        // Re-attach on the next chat event so the active backend takes effect.
        runtime.storageReady = false;
        runtime.storageBackendUsed = value;
    });
    bindNumber('il_request_timeout', 'requestTimeoutSeconds', 15, 300);
    bindNumber('il_process_every', 'processEveryAssistantTurns', 1, 20);
    bindCheckbox('il_adaptive_maintenance', 'adaptiveMaintenanceEnabled');
    bindNumber('il_minimum_adaptive_batch', 'minimumAdaptiveBatchTurns', 1, 10);
    bindNumber('il_lookback_messages', 'lookbackMessages', 2, 40);
    bindNumber('il_max_entities_per_pass', 'maximumEntitiesPerPass', 1, 20);
    bindNumber('il_max_minds_per_pass', 'maximumMindOperationsPerPass', 1, 50);
    bindNumber('il_minimum_importance', 'minimumImportance', 0, 100);
    bindNumber('il_auto_rebuild_limit', 'autoRebuildMessageLimit', 10, 1_000);
    bindNumber('il_maximum_thoughts', 'maximumThoughtsPerBrain', 4, 200);
    bindNumber('il_maximum_thought_changes', 'maximumThoughtChangesPerBrain', 1, 50);
    bindNumber('il_minimum_story_facet_observations', 'minimumStoryFacetObservations', 1, 5);
    bindNumber('il_brain_consolidation_similarity', 'brainConsolidationSimilarity', 0.75, 0.99);
    bindNumber('il_maximum_scene_thoughts', 'maximumSceneThoughtsPerBrain', 0, 20);
    bindNumber('il_maximum_active_brains', 'maximumActiveBrains', 1, 20, makeContextConfigurationCustom);
    bindNumber('il_maximum_injected_thoughts', 'maximumInjectedThoughtsPerBrain', 1, 20, makeContextConfigurationCustom);
    bindNumber('il_scene_thought_age', 'maximumSceneThoughtAge', 1, 40, updateInjection);
    bindNumber('il_brain_budget', 'brainInjectionBudget', 500, 50_000, makeContextConfigurationCustom);
    bindNumber('il_lore_budget', 'loreInjectionBudget', 500, 60_000, makeContextConfigurationCustom);
    bindNumber('il_maximum_injected_entities', 'maximumInjectedEntities', 1, 30, makeContextConfigurationCustom);
    bindNumber('il_scene_lookback', 'sceneLookbackMessages', 2, 10, updateInjection);
    bindNumber('il_scene_budget', 'sceneInjectionBudget', 400, 8_000, makeContextConfigurationCustom);
    bindNumber('il_injection_depth', 'injectionDepth', 0, 100, () => {
        runtime.lastInjection = '';
        runtime.lastTurnContract = '';
        updateInjection();
    });
    bindSelect('il_context_delivery_mode', 'contextDeliveryMode', ['automatic', 'macro'], () => {
        runtime.lastInjection = '';
        updateInjection();
        void prepareServerContext({ force: true });
    });
    bindNumber('il_server_context_timeout', 'serverContextTimeoutMs', 250, 5_000);
    bindSelect('il_connection_source', 'connectionSource', ['profile', 'active'], () => applySettingsToUI());
    bindSelect('il_card_detail', 'cardDetail', ['compact', 'detailed', 'expansive']);
    bindSelect('il_progression_autonomy', 'progressionAutonomy', ['advisory', 'conservative', 'simulation', 'director'], updateInjection);
    bindSelect('il_progression_time_mode', 'progressionTimeMode', ['cinematic', 'balanced', 'simulation']);
    bindNumber('il_progression_every', 'progressionEveryAssistantTurns', 1, 20);
    bindNumber('il_progression_maximum_response_tokens', 'progressionMaximumResponseTokens', 800, 32_000);
    bindNumber('il_progression_temperature', 'progressionTemperature', 0, 1.5);
    bindNumber('il_progression_request_timeout', 'progressionRequestTimeoutSeconds', 15, 90);
    bindNumber('il_progression_maximum_goals', 'progressionMaximumGoals', 1, 200);
    bindNumber('il_progression_maximum_processes', 'progressionMaximumProcesses', 1, 200);
    bindNumber('il_progression_maximum_events', 'progressionMaximumEvents', 1, 200);
    bindNumber('il_progression_maximum_injected', 'progressionMaximumInjectedEntries', 1, 30, makeContextConfigurationCustom);
    bindNumber('il_progression_injection_budget', 'progressionInjectionBudget', 500, 40_000, makeContextConfigurationCustom);
    bindNumber('il_progression_rebuild_batch', 'progressionRebuildBatchMessages', 2, 100);
    bindNumber('il_trigger_delivery_attempts', 'triggerDeliveryMaximumAttempts', 1, 20);
    bindNumber('il_trigger_attempt_previews', 'triggerAttemptPreviewMaximum', 1, 20);
    bindCheckbox('il_event_director_enabled', 'automaticEventDirectorEnabled', updateUI);
    bindSelect('il_event_director_mode', 'automaticEventDirectorMode', ['review', 'auto_arm'], updateUI);
    bindSelect('il_event_director_activity', 'automaticEventDirectorActivity', ['quiet', 'balanced', 'lively'], updateUI);
    bindNumber('il_event_director_confidence', 'automaticEventDirectorMinimumConfidence', 0.5, 1, updateUI);
    bindNumber('il_event_director_expiration', 'automaticEventDirectorExpirationTurns', 4, 200, updateUI);
    bindCheckbox('il_event_director_private_minds', 'automaticEventDirectorIncludePrivateMinds', updateUI);

    document.getElementById('il_connection_profile')?.addEventListener('change', event => {
        getSettings().connectionProfileId = event.target.value;
        saveSettings();
    });
    document.getElementById('il_fallback_connection_profile')?.addEventListener('change', event => {
        getSettings().fallbackConnectionProfileId = event.target.value;
        saveSettings();
    });
    document.getElementById('il_provider_concurrency')?.addEventListener('change', event => {
        getSettings().providerConcurrency = providerConcurrency({ providerConcurrency: event.target.value });
        saveSettings();
    });
    document.getElementById('il_progression_profile')?.addEventListener('change', event => {
        getSettings().progressionConnectionProfileId = event.target.value;
        saveSettings();
    });
    document.getElementById('il_progression_fallback_profile')?.addEventListener('change', event => {
        getSettings().progressionFallbackConnectionProfileId = event.target.value;
        saveSettings();
    });
    document.getElementById('il_story_provider_body')?.addEventListener('change', event => {
        getSettings().storyProviderBody = cleanString(event.target.value, 2_000);
        context().saveSettingsDebounced();
    });
    document.getElementById('il_custom_instructions')?.addEventListener('change', event => {
        getSettings().customInstructions = cleanString(event.target.value, 4_000);
        saveSettings();
    });
    document.getElementById('il_progression_custom_instructions')?.addEventListener('change', event => {
        getSettings().progressionCustomInstructions = cleanString(event.target.value, 5_000);
        saveSettings();
    });
    bindCheckbox('il_parallel_passes', 'parallelBackgroundPasses');
    bindCheckbox('il_game_enabled', 'gameEnabled', () => {
        updateInjection();
        updateUI();
    });
    bindCheckbox('il_game_ledger_enabled', 'gameLedgerEnabled');
    bindCheckbox('il_game_tools', 'gameToolsEnabled', () => {
        ensureToolCallingSetup();
        updateInjection();
    });
    bindCheckbox('il_scene_planner_enabled', 'scenePlannerEnabled');
    bindCheckbox('il_scene_planner_prefetch', 'scenePlannerPrefetch');
    bindCheckbox('il_story_preempts_background', 'storyPreemptsBackground');
    bindCheckbox('il_scene_planner_at_send', 'scenePlannerAtSend');
    bindNumber('il_scene_planner_wait', 'scenePlannerSendWaitSeconds', 0, 180);
    bindNumber('il_scene_planner_places', 'scenePlannerMaximumPlaces', 1, 3);
    bindNumber('il_scene_planner_stale_hours', 'scenePlannerStaleHours', 1, 168);
    bindNumber('il_game_injection_budget', 'gameInjectionBudget', 500, 20_000, () => updateInjection());
    for (const [id, key] of [['il_game_profile', 'gameConnectionProfileId'], ['il_planner_profile', 'plannerConnectionProfileId'], ['il_minds_profile', 'mindsConnectionProfileId']]) {
        document.getElementById(id)?.addEventListener('change', event => {
            getSettings()[key] = event.target.value;
            saveSettings();
        });
    }
    for (const [id, key] of [['il_game_custom_instructions', 'gameCustomInstructions'], ['il_planner_custom_instructions', 'plannerCustomInstructions']]) {
        document.getElementById(id)?.addEventListener('change', event => {
            getSettings()[key] = cleanString(event.target.value, 3_000);
            saveSettings();
        });
    }
    bindSelect('il_assisted_background', 'assistedBackground', ['auto', 'on', 'off']);
    bindCheckbox('il_cast_cards', 'castCardsEnabled', () => updateCastCards());
    bindCheckbox('il_portraits_enabled', 'portraitsEnabled', () => updateCastCards());
    bindNumber('il_portrait_steps', 'portraitSteps', 1, 60);
    bindNumber('il_portrait_cfg', 'portraitCfg', 1, 20);
    for (const [id, key, limit] of [['il_portrait_url', 'portraitServerUrl', 300], ['il_portrait_style', 'portraitStyle', 400], ['il_portrait_negative', 'portraitNegative', 1_000]]) {
        document.getElementById(id)?.addEventListener('change', event => {
            getSettings()[key] = cleanString(event.target.value, limit);
            saveSettings();
        });
    }
    bindCheckbox('il_voice_enabled', 'voiceEnabled', () => {
        if (getSettings().voiceEnabled) void probeVoiceServer({ force: true });
        else stopSpeaking();
        ensureVoiceButtons();
        ensureVoiceTagRegex();
        renderMenuBar();
    });
    bindCheckbox('il_voice_autoplay', 'voiceAutoPlay', () => renderMenuBar());
    bindCheckbox('il_voice_dialogue', 'voiceDialogue');
    bindCheckbox('il_voice_streaming', 'voiceStreaming');
    bindCheckbox('il_voice_skip_tags', 'voiceSkipTags');
    bindCheckbox('il_voice_tags', 'voiceTags', () => ensureVoiceTagRegex());
    bindNumber('il_voice_gap', 'voiceGapMs', 0, 1_000);
    bindNumber('il_voice_emotion', 'voiceEmotion', 0, 1.5);
    bindNumber('il_voice_child_pitch', 'voiceChildPitch', 0, 8);
    bindNumber('il_voice_steps', 'voiceSteps', 0, 50);
    bindNumber('il_voice_silence', 'voiceSilence', 0, 5);
    bindNumber('il_voice_takes', 'voiceTakes', 1, 3);
    bindCheckbox('il_voice_narration', 'voiceNarration');
    bindNumber('il_voice_speed', 'voiceSpeed', 0.6, 1.5);
    for (const [id, key] of [['il_voice_narrator', 'voiceNarrator'], ['il_voice_player', 'voicePlayer'], ['il_voice_unknown', 'voiceUnknown'], ['il_voice_thought', 'voiceThought']]) {
        document.getElementById(id)?.addEventListener('change', event => {
            getSettings()[key] = cleanString(event.target.value, 40);
            saveSettings();
        });
    }
    bindSelect('il_voice_italics', 'voiceItalics', ['thought', 'narrator', 'skip']);
    bindCheckbox('il_voice_live', 'voiceLive', () => setLiveMode(getSettings().voiceLive, { fromSettings: true }));
    document.getElementById('il_voice_url')?.addEventListener('change', event => {
        getSettings().voiceServerUrl = cleanString(event.target.value, 300);
        saveSettings();
        void probeVoiceServer({ force: true });
    });
    bindCheckbox('il_voice_input_enabled', 'voiceInputEnabled', () => ensureMicButton());
    bindSelect('il_voice_input_provider', 'voiceInputProvider', ['local', 'browser'], () => ensureMicButton());
    bindSelect('il_voice_input_mode', 'voiceInputMode', ['box', 'send']);
    document.getElementById('il_voice_input_language')?.addEventListener('change', event => {
        getSettings().voiceInputLanguage = cleanString(event.target.value, 20) || 'en-US';
        saveSettings();
    });
    document.getElementById('il_voice_test')?.addEventListener('click', async () => {
        const voice = await probeVoiceServer({ force: true });
        toastr[voice.status === 'ok' ? 'success' : 'warning'](`Voice server: ${voice.detail}`, DISPLAY_NAME);
    });
    document.getElementById('il_open_game_panel')?.addEventListener('click', () => openGamePanel('bag'));
    document.getElementById('il_reset_game')?.addEventListener('click', resetGameState);
    document.getElementById('il_context_profile')?.addEventListener('change', event => {
        const profileId = cleanString(event.target.value, 64).toLocaleLowerCase();
        const profile = runtime.contextProfiles.find(item => item.id === profileId)
            || contextProfileById(profileId, runtime.contextProfiles);
        applyContextProfileToSettings(getSettings(), profile);
        saveSettings();
        applySettingsToUI();
        refreshContextAfterConfigurationChange();
    });
    document.getElementById('il_context_maximum')?.addEventListener('change', event => {
        setCustomContextMaximum(getSettings(), event.target.value);
        saveSettings();
        applySettingsToUI();
        refreshContextAfterConfigurationChange();
    });
    const nudgeContextMaximum = delta => {
        setCustomContextMaximum(getSettings(), Number(getSettings().contextMaximumCharacters) + delta);
        saveSettings();
        applySettingsToUI();
        refreshContextAfterConfigurationChange();
    };
    document.getElementById('il_context_decrease')?.addEventListener('click', () => nudgeContextMaximum(-1_000));
    document.getElementById('il_context_increase')?.addEventListener('click', () => nudgeContextMaximum(1_000));
    document.querySelectorAll('#il_entity_types input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', () => {
            getSettings().enabledEntityTypes = [...document.querySelectorAll('#il_entity_types input:checked')].map(item => item.value);
            saveSettings();
        });
    });
    document.getElementById('il_trigger_event_actor_scope')?.addEventListener('change', event => {
        document.getElementById('il_trigger_event_named_actor_row')
            ?.classList.toggle('displayNone', event.target.value !== 'named');
    });
    document.getElementById('il_trigger_event_enabled')?.addEventListener('change', event => {
        updateTriggerEventSaveButton(Boolean(event.target.checked));
    });

    document.getElementById('il_scan_now')?.addEventListener('click', () => processPending({ force: true }));
    document.getElementById('il_rebuild')?.addEventListener('click', () => {
        if (confirm('Rebuild InnerLore from the current chat? Existing automatic state will be replaced, while protected manual lore and pinned records are retained.')) {
            rebuildFromChat();
        }
    });
    document.getElementById('il_stop')?.addEventListener('click', stopCurrentPass);
    document.getElementById('il_open_lorebook')?.addEventListener('click', async () => {
        try {
            const store = getChatStore();
            if (!store) throw new Error('Open a chat first.');
            await openInnerLorebook(store, { chatId: store.chatId, characterName: context().name2 });
            rememberLorebook(store);
            await saveChatStore();
            updateUI();
        } catch (error) {
            toastr.error(error.message || String(error), DISPLAY_NAME);
        }
    });
    document.getElementById('il_test_connection')?.addEventListener('click', async () => {
        setStatus('working', 'Testing', 'Sending a minimal JSON request…');
        try {
            await testInnerLoreConnection(getSettings());
            setStatus('success', 'Connected', 'The selected model returned valid InnerLore JSON.');
            toastr.success('Connection returned valid JSON.', DISPLAY_NAME);
        } catch (error) {
            setStatus('error', 'Test failed', error.message || String(error));
            toastr.error(error.message || String(error), DISPLAY_NAME);
        }
    });
    document.getElementById('il_test_progression_connection')?.addEventListener('click', async () => {
        setStatus('working', 'Testing progression', 'Sending a minimal World Progression JSON request…');
        try {
            await testProgressionConnection(getSettings());
            setStatus('success', 'Connected', 'The progression model returned valid time, goal, process, and event JSON.');
            toastr.success('World Progression connection returned valid JSON.', DISPLAY_NAME);
        } catch (error) {
            setStatus('error', 'Test failed', error.message || String(error));
            toastr.error(error.message || String(error), DISPLAY_NAME);
        }
    });
    document.getElementById('il_reset_progression')?.addEventListener('click', resetWorldProgression);
    document.getElementById('il_refresh_preview')?.addEventListener('click', updateInjection);

    document.getElementById('il_narrator_prompt_enabled')?.addEventListener('change', event => {
        getSettings().narratorPromptEnabled = event.target.checked;
        saveSettings();
    });
    document.getElementById('il_history_in_macro')?.addEventListener('change', event => {
        getSettings().historyInMacroEnabled = event.target.checked;
        saveSettings();
        if (event.target.checked) syncNarrativeLog();
    });
    // Budget mode is pinned to Derived and cannot be switched off; only the
    // share percentages and safety margin are configurable.
    const derivedShareKeys = ['response', 'history', 'scene', 'minds', 'lore', 'progression', 'game'];
    for (const key of derivedShareKeys) {
        document.getElementById(`il_derived_share_${key}`)?.addEventListener('change', event => {
            const settings = getSettings();
            const shares = { ...(settings.derivedSectionShares || DERIVED_SHARE_DEFAULTS) };
            shares[key] = Math.max(0, Math.min(100, Number(event.target.value) || 0));
            settings.derivedSectionShares = shares;
            saveSettings();
            updateContextBudgetUI();
        });
    }
    document.getElementById('il_derived_margin')?.addEventListener('change', event => {
        const settings = getSettings();
        settings.derivedSafetyMarginPercent = Math.max(0, Math.min(50, Number(event.target.value) || 0));
        saveSettings();
        updateContextBudgetUI();
    });
    document.getElementById('il_history_budget')?.addEventListener('change', event => {
        getSettings().historyBudgetCharacters = Math.max(500, Math.min(40_000, Number(event.target.value) || 6_000));
        saveSettings();
    });
    document.getElementById('il_history_max_turns')?.addEventListener('change', event => {
        getSettings().historyMaxTurns = Math.max(2, Math.min(200, Number(event.target.value) || 24));
        saveSettings();
    });
    document.getElementById('il_narration_length')?.addEventListener('change', event => {
        const value = ['brief', 'standard', 'long'].includes(event.target.value) ? event.target.value : 'standard';
        getSettings().narrationLength = value;
        saveSettings();
    });
    document.getElementById('il_guided_play')?.addEventListener('change', event => {
        getSettings().guidedPlayEnabled = event.target.checked;
        saveSettings();
        renderPlayerChoices();
    });
    document.getElementById('il_narrator_prompt')?.addEventListener('change', event => {
        const value = cleanString(event.target.value, 20_000);
        getSettings().narratorPromptTemplate = value;
        saveSettings();
    });
    document.getElementById('il_narrator_prompt_preview')?.addEventListener('click', async () => {
        const output = document.getElementById('il_narrator_prompt_preview_out');
        if (!output) return;
        const settings = getSettings();
        const template = settings.narratorPromptTemplate || DEFAULT_NARRATOR_PROMPT;
        try {
            const scriptModule = await import('/script.js');
            const expanded = await scriptModule.substituteParams(template);
            output.value = expanded;
            output.classList.remove('displayNone');
        } catch (error) {
            toastr.error(`Could not expand the narrator prompt: ${error?.message || error}`, DISPLAY_NAME);
        }
    });
    document.getElementById('il_export_telemetry')?.addEventListener('click', () => {
        const data = getTelemetry();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `innerlore-speed-telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        toastr.info(`Exported ${data.entries.length} telemetry entries across ${data.turnId} turn(s).`, DISPLAY_NAME);
    });
    document.getElementById('il_narrator_prompt_reset')?.addEventListener('click', () => {
        getSettings().narratorPromptTemplate = DEFAULT_NARRATOR_PROMPT;
        saveSettings();
        setInputValue('il_narrator_prompt', DEFAULT_NARRATOR_PROMPT);
        const output = document.getElementById('il_narrator_prompt_preview_out');
        output?.classList.add('displayNone');
        toastr.success('Narrator prompt restored to the InnerLore default.', DISPLAY_NAME);
    });

    document.getElementById('il_entity_select')?.addEventListener('change', event => {
        runtime.selectedEntityId = event.target.value;
        renderEntityEditor();
    });
    document.getElementById('il_save_entity')?.addEventListener('click', saveSelectedEntity);
    document.getElementById('il_auto_entity')?.addEventListener('click', restoreSelectedEntityAutomation);
    document.getElementById('il_delete_entity')?.addEventListener('click', deleteSelectedEntity);

    document.getElementById('il_brain_select')?.addEventListener('change', event => {
        runtime.selectedBrainId = event.target.value;
        runtime.brainJsonDirty = false;
        renderBrainEditor();
    });
    document.getElementById('il_brain_view_mind')?.addEventListener('click', () => {
        runtime.brainView = 'visual';
        updateBrainViewPanes();
    });
    document.getElementById('il_brain_view_raw')?.addEventListener('click', () => {
        runtime.brainView = 'raw';
        updateBrainViewPanes();
    });
    document.getElementById('il_brain_json')?.addEventListener('input', () => {
        if (!runtime.brainJsonDirty) {
            runtime.brainJsonDirty = true;
            updateBrainViewPanes();
        }
    });
    document.getElementById('il_brain_visual')?.addEventListener('click', event => {
        const toggle = event.target.closest?.('#il_brain_visual .il-mv-collapsible > .il-mv-card-toggle');
        if (!toggle) return;
        const card = toggle.closest('.il-mv-collapsible');
        if (!card) return;
        const collapsed = card.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        const groupId = card.dataset.group;
        if (groupId) {
            const state = brainGroupCollapseMap();
            state[groupId] = collapsed;
            try { localStorage.setItem('InnerLore_BrainGroups', JSON.stringify(state)); } catch { /* private mode */ }
        }
    });
    document.getElementById('il_add_brain')?.addEventListener('click', addBrain);
    document.getElementById('il_save_brain')?.addEventListener('click', saveSelectedBrain);
    document.getElementById('il_delete_brain')?.addEventListener('click', deleteSelectedBrain);

    document.getElementById('il_trigger_event_select')?.addEventListener('change', event => {
        runtime.selectedTriggerEventId = event.target.value;
        renderTriggerEventEditor();
    });
    document.getElementById('il_trigger_event_actor_scope')?.addEventListener('change', event => {
        document.getElementById('il_trigger_event_named_actor_row')
            ?.classList.toggle('displayNone', event.target.value !== 'named');
    });
    document.getElementById('il_add_trigger_event')?.addEventListener('click', addTriggerEvent);
    document.getElementById('il_arm_trigger_event')?.addEventListener('click', async () => {
        const enableBox = document.getElementById('il_trigger_event_enabled');
        if (enableBox && !enableBox.checked) {
            enableBox.checked = true;
            enableBox.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await saveSelectedTriggerEvent();
    });
    document.getElementById('il_save_trigger_event')?.addEventListener('click', saveSelectedTriggerEvent);
    document.getElementById('il_rearm_trigger_event')?.addEventListener('click', rearmSelectedTriggerEvent);
    document.getElementById('il_retry_trigger_event_delivery')?.addEventListener('click', retrySelectedTriggerEventDelivery);
    document.getElementById('il_delete_trigger_event')?.addEventListener('click', deleteSelectedTriggerEvent);
    document.getElementById('il_event_director_generate')?.addEventListener('click', generateAutomaticEventNow);
    document.getElementById('il_event_proposal_select')?.addEventListener('change', event => {
        runtime.selectedEventProposalId = event.target.value;
        renderEventDirectorUI();
    });
    document.getElementById('il_event_proposal_approve')?.addEventListener('click', approveSelectedEventProposal);
    document.getElementById('il_event_proposal_reject')?.addEventListener('click', rejectSelectedEventProposal);
    document.getElementById('il_event_proposal_delete')?.addEventListener('click', deleteSelectedEventProposal);
}

function registerSlashCommands() {
    const ctx = context();
    if (!ctx.SlashCommandParser?.addCommandObject || !ctx.SlashCommand?.fromProps) return;
    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'innerlore-scan',
        callback: async () => {
            await processPending({ force: true });
            return 'InnerLore scan finished.';
        },
        helpString: 'Analyze new turns and update InnerLore now.',
    }));
    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'innerlore-rebuild',
        callback: async () => {
            await rebuildFromChat();
            return 'InnerLore rebuild finished.';
        },
        helpString: 'Rebuild private minds and automatic lore from the current chat.',
    }));
    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'innerlore-status',
        callback: () => {
            const store = getChatStore();
            if (!store) return 'InnerLore: no active chat.';
            const progression = getProgressionStats(store.progression);
            return `InnerLore: ${Object.keys(store.entities).length} lore entries, ${Object.keys(store.brains).length} minds, processed through message ${store.lastProcessedIndex}; story clock ${progression.clock}, ${progression.activeGoals} active goals, ${progression.activeProcesses} active processes, ${progression.due} due/possible beats, ${progression.triggerEvents.enabled} enabled editor events (${progression.activeTriggerEvents} active, ${progression.observableTriggerEvents} observable)${store.needsRebuild ? '; rebuild required and stale injection quarantined' : ''}.`;
        },
        helpString: 'Show InnerLore state counts for the current chat.',
    }));
    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'innerlore-time',
        callback: () => {
            const store = getChatStore();
            if (!store) return 'InnerLore: no active chat.';
            const state = normalizeProgressionState(store.progression);
            const label = state.clock.currentTimeLabel ? `; ${state.clock.currentTimeLabel}` : '';
            const anchor = state.clock.lastExactAnchor ? `; last anchor: ${state.clock.lastExactAnchor}` : '';
            return `Elapsed story time: ${formatClockRange(state.clock)}${label}${anchor}.`;
        },
        helpString: 'Show the private World Progression story clock.',
    }));
}

function queueCompletedAssistantTurn(store) {
    clearAnalysisRetry();
    store.assistantTurnsSincePass++;
    // A newly completed story turn starts a fresh retry episode while keeping
    // the previous diagnostic visible until the next successful pass.
    store.consecutiveFailures = 0;
    store.nextRetryAt = 0;
    context().saveMetadataDebounced?.();
    updateInjection();
    if (getSettings().autoUpdate) {
        setTimeout(() => processPending({ silent: true }), 500);
    }
}

async function recoverIncompleteReply(messageIndex, initialReason) {
    // Provider state at the moment of failure - not minutes later when
    // recovery has finished - is what diagnoses the cause.
    const failureContext = {
        backgroundInFlight: backgroundInFlightCount(),
        peerStory: Boolean(runtime.peerStoryActiveAt && Date.now() - runtime.peerStoryActiveAt < 120_000),
        storyRequestInFlight: Boolean(runtime.storyRequestInFlight),
    };
    recordTelemetryEntry({ kind: 'story', phase: 'quarantine-start', ...failureContext, reason: String(initialReason).slice(0, 60) });
    const ctx = context();
    const runChatId = currentChatId();
    const settings = getSettings();
    const maximumAttempts = Math.max(1, Math.min(3, Number(settings.incompleteRecoveryAttempts) || 2));
    const recoveryPromptKey = 'inner_lore_cutoff_recovery';
    let attempts = 0;
    let reason = initialReason;
    let errorText = '';
    const requiresRegeneration = value => value === 'empty output'
        || value === 'prompt instruction echo'
        || value === 'internal prompt markup exposed';
    runtime.cutoffRecovery = true;
    const initialRegeneration = requiresRegeneration(reason);
    setStatus(
        'working',
        initialRegeneration ? 'Regenerating invalid reply' : 'Completing reply',
        reason === 'empty output'
            ? 'The provider returned no story text; regenerating the turn…'
            : initialRegeneration
                ? 'The provider exposed private control text; regenerating a clean story reply…'
            : `Detected ${reason}; continuing from the exact cutoff…`,
    );

    try {
        // Let SillyTavern finish saving and unlocking the just-ended stream.
        await new Promise(resolve => setTimeout(resolve, 250));
        while (reason && attempts < maximumAttempts) {
            const message = ctx.chat?.[messageIndex];
            const hasTypedInput = Boolean(document.getElementById('send_textarea')?.value?.trim());
            if (currentChatId() !== runChatId || messageIndex !== ctx.chat.length - 1 || !message || hasTypedInput) break;
            if (typeof ctx.generate !== 'function') throw new Error('SillyTavern generation recovery is unavailable.');

            attempts++;
            const regenerateOutput = requiresRegeneration(reason);
            ctx.setExtensionPrompt(
                recoveryPromptKey,
                reason === 'empty output'
                    ? 'The preceding generation returned no usable story text. Generate the complete next roleplay reply from the latest user turn and established canon. Do not mention the failed attempt, do not write the user character’s unprovided actions or dialogue, and end on a complete sentence.'
                    : regenerateOutput
                        ? 'The preceding generation exposed narrator-only control text and is invalid. Regenerate the complete next roleplay reply as natural story prose. Do not quote, label, paraphrase, or mention any prompt, control block, schema, word-count instruction, or failed attempt. Preserve established canon and player agency, and end on a complete sentence.'
                    : 'The immediately preceding assistant reply was interrupted by transport failure. Continue from its exact final word. Supply only the missing continuation: do not restart, recap, revise, or replace any existing text. First complete the severed sentence or quotation, then finish the same small narrative beat naturally.',
                1,
                0,
                false,
                0,
            );
            // Continue can only append to existing prose. Empty or contaminated
            // output must be replaced from the preceding user turn.
            await ctx.generate(regenerateOutput ? 'regenerate' : 'continue', { automatic_trigger: true });
            reason = generatedProseIssue(ctx.chat?.[messageIndex]?.mes);
        }
    } catch (error) {
        errorText = cleanString(error.message || String(error), 1_000);
        console.error(LOG_PREFIX, 'Incomplete reply recovery failed:', error);
    } finally {
        ctx.setExtensionPrompt(recoveryPromptKey, '', 1, 0, false, 0);
        if (currentChatId() !== runChatId) {
            runtime.cutoffRecovery = false;
            return;
        }
        const message = ctx.chat?.[messageIndex];
        const finalReason = generatedProseIssue(message?.mes);
        const completed = Boolean(message) && !finalReason;
        let quarantined = false;
        const store = getChatStore();
        if (store) {
            store.lastOutputRecovery = {
                messageIndex,
                attempts,
                completed,
                initialReason,
                finalReason,
                error: errorText,
                quarantined: false,
                backgroundInFlight: failureContext.backgroundInFlight,
                peerStory: failureContext.peerStory,
                storyRequestInFlight: failureContext.storyRequestInFlight,
                at: Date.now(),
            };
        }
        if (message) {
            message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
            message.extra.inner_lore_output_recovery = {
                attempts,
                completed,
                reason: finalReason || initialReason,
                quarantined: !completed,
            };
            if (completed) {
                await ctx.saveChat?.();
            } else {
                // Never leave unusable provider text visible in chat history.
                // Scrub first so even a UI/API deletion failure cannot expose
                // control text; then remove the bubble when SillyTavern's
                // branch-safe deletion API is available.
                message.mes = '';
                quarantined = true;
                try {
                    if (messageIndex === ctx.chat.length - 1 && typeof ctx.deleteLastMessage === 'function') {
                        await ctx.deleteLastMessage();
                    } else if (typeof ctx.deleteMessage === 'function') {
                        await ctx.deleteMessage(messageIndex, undefined, false);
                    }
                    await ctx.saveChat?.();
                } catch (quarantineError) {
                    errorText = cleanString(
                        `${errorText ? `${errorText}; ` : ''}quarantine cleanup: ${quarantineError?.message || quarantineError}`,
                        1_000,
                    );
                    await ctx.saveChat?.();
                }
            }
        }
        if (store?.lastOutputRecovery) {
            store.lastOutputRecovery.quarantined = quarantined;
            store.lastOutputRecovery.error = errorText;
        }
        runtime.cutoffRecovery = false;
        // Never curate an empty, severed, or contaminated reply, and never
        // advance the world clock for a turn the user did not actually receive.
        if (store && completed) {
            if (store.needsRebuild) {
                runtime.deferHistoryRebuild = false;
                runtime.historyRebuildQueued = true;
                scheduleQueuedHistoryRebuild(0);
            } else {
                queueCompletedAssistantTurn(store);
            }
        }
        if (completed) {
            setStatus('success', 'Reply recovered', `Recovered a clean, complete output in ${attempts} attempt${attempts === 1 ? '' : 's'}.`);
        } else {
            const detail = errorText || (document.getElementById('send_textarea')?.value?.trim()
                ? 'Automatic completion paused because text is waiting in the input box.'
                : `The unusable reply was quarantined (${finalReason || initialReason}).`);
            setStatus('error', 'Reply quarantined', detail);
            toastr.warning(detail, DISPLAY_NAME, { timeOut: 8_000 });
        }
    }
}

function scheduleRequestedRecoveryOnLoad() {
    const ctx = context();
    const messageIndex = ctx.chat.length - 1;
    const message = ctx.chat[messageIndex];
    if (!getSettings().enabled || !getSettings().autoRecoverIncomplete
        || !message || message.is_user || message.is_system
        || message.extra?.inner_lore_recover_on_load !== true) return false;
    const reason = generatedProseIssue(message.mes);
    delete message.extra.inner_lore_recover_on_load;
    ctx.saveChat?.();
    if (!reason) return false;
    setTimeout(() => {
        if (!runtime.cutoffRecovery && currentChatId()) recoverIncompleteReply(messageIndex, reason);
    }, 250);
    return true;
}

function registerEvents() {
    if (runtime.eventsRegistered) return;
    runtime.eventsRegistered = true;
    const { eventSource, eventTypes, event_types } = context();
    const events = eventTypes || event_types;
    if (events.MESSAGE_SENT) {
        eventSource.on(events.MESSAGE_SENT, () => {
        runtime.currentTelemetryTurn = nextTelemetryTurn();
        runtime.turnSentAt = Date.now();
        recordTelemetryEntry({ kind: 'story', phase: 'sent' });
            // A new turn: what the trade screen asked for is applied now, so
            // the story narrates a done deal instead of guessing at one.
            ensureTurnActions(true).reply = context().chat.length;
            resolvePanelActions();
            // A move to a place with nothing prepared starts the planner now.
            maybeStageDestination();
            // GENERATION_STARTED fires before SillyTavern moves the textarea
            // into chat. Refresh again here so the current player action—and
            // an explicit time skip such as “five minutes pass”—is in the
            // prompt assembled immediately after this awaited event.
            updateInjection();
            updateTriggerDeliveryPrompt({ recordInjection: true });
            // The event-delivery latch is installed synchronously above. The
            // returned promise lets SillyTavern await bounded server context
            // preparation without delaying that mandatory trigger block.
            return prepareServerContext().then(() => updateInjection());
        });
    }
    eventSource.on(events.MESSAGE_RECEIVED, (messageIndex, generationType) => {
        if (interceptTextToolCalls(messageIndex)) return;
        scheduleAutoVoice(messageIndex);
        captureReplyChoices(messageIndex);
        runtime.choicesHidden = false;
        const store = getChatStore();
        const message = context().chat[messageIndex];
        if (!store && message && !message.is_user && !message.is_system) {
            // A brand-new chat can complete its first fast story reply before
            // the storage backend finishes attaching. Without a deferred
            // re-check, an empty first reply skips quarantine recovery and
            // sits in the chat forever.
            setTimeout(() => {
                if (runtime.cutoffRecovery || currentChatId() !== (context().chatId ?? '')) return;
                const retryMessage = context().chat[messageIndex];
                if (!retryMessage || retryMessage.is_user || retryMessage.is_system) return;
                if (!generatedProseIssue(retryMessage.mes)) return;
                eventSource.emit(events.MESSAGE_RECEIVED ?? 'message_received', messageIndex, generationType);
            }, 4_000);
            return;
        }
        if (!store || !message || message.is_user || message.is_system) return;
        if (runtime.cutoffRecovery) return;

        // A manual Continue can append to a message already represented in the
        // store. Rebuild from selected history so elapsed time is not counted
        // twice and discarded text cannot survive in lore.
        if (generationType === 'continue' && store.lastProcessedIndex >= messageIndex) {
            scheduleHistoryRebuild();
            return;
        }

        const stoppedByUser = Date.now() - runtime.userStoppedGenerationAt < 2_000;
        const cutoffReason = getSettings().enabled && getSettings().autoRecoverIncomplete && !stoppedByUser
            ? generatedProseIssue(message.mes)
            : '';
        if (cutoffReason) {
            recoverIncompleteReply(messageIndex, cutoffReason);
            return;
        }
        if (store.needsRebuild) {
            // A reswipe can use only the real structured psychology retained
            // in its branch-safe prefix. Once the replacement exists, rebuild
            // every derived subsystem from that selected branch before any
            // later normal generation is allowed to proceed.
            runtime.deferHistoryRebuild = false;
            runtime.historyRebuildQueued = true;
            scheduleQueuedHistoryRebuild(0);
            return;
        }
        const deliveryVerification = verifyTriggerEventDeliveriesFromStory(
            store.progression,
            message.mes,
            { messageIndex },
        );
        store.progression = deliveryVerification.state;
        if (deliveryVerification.changed) {
            void saveChatStore().catch(error => {
                console.error(`${LOG_PREFIX} Could not persist foreground event verification:`, error);
            });
        }
        runtime.storyRequestInFlight = false;
        runtime.announceStoryState?.(false);
        if (runtime.storyDepartedAt) {
            recordTelemetryEntry({ kind: 'story', phase: 'reply', durationMs: Date.now() - runtime.storyDepartedAt });
        }
        const turn = runtime.currentTelemetryTurn;
        const entries = getTelemetry().entries.filter(item => item.turn === turn);
        const bg = entries.filter(item => item.phase === 'background');
        const storyWait = entries.find(item => item.phase === 'departed');
        const storyReply = entries.find(item => item.phase === 'reply');
        console.info(`[InnerLore] Turn ${turn} timeline: send->depart ${((storyWait?.timeSinceSentMs ?? 0) / 1000).toFixed(1)}s (waited ${((storyWait?.waitedForBackgroundMs ?? 0) / 1000).toFixed(1)}s for background) | story ${((storyReply?.durationMs ?? 0) / 1000).toFixed(1)}s | background before reply: ${bg.filter(item => item.t <= (storyReply?.t ?? Infinity)).length} pass(es), ${((bg.filter(item => item.t <= (storyReply?.t ?? Infinity)).reduce((sum, item) => sum + item.durationMs, 0)) / 1000).toFixed(1)}s total`);
        queueCompletedAssistantTurn(store);
        // Immediate, model-free HUD refresh: rebuild the scene from the new
        // reply deterministically so location and present cast update the
        // moment a reply lands, instead of waiting for the background pass.
        try {
            const freshScene = deriveSceneState(context().chat, store, {
                currentIndex: messageIndex,
                playerName: context().name1,
                lookbackMessages: getSettings().sceneLookbackMessages ?? 4,
            });
            runtime.lastCompilation = { ...(runtime.lastCompilation || {}), scene: resolveSceneLocationForDisplay(freshScene) };
        } catch (error) {
            console.error('[InnerLore] Could not rebuild the scene for the HUD:', error);
        }
        updateCastCards();
    });
    eventSource.on(events.GENERATION_STARTED, async (generationType, _generationOptions, isDryRun) => {
        // Claim the provider before any awaited listener work: a background
        // timer firing during prompt assembly must see the story as active.
        // Quiet generations (auto-title on a new chat's first message) share
        // the same single-slot provider and are serialized the same way.
        const storyStart = generationType !== 'impersonate';
        // The moves under the previous reply go stale once a new reply starts.
        if (!isDryRun && storyStart && generationType !== 'quiet') {
            runtime.choicesHidden = true;
            renderPlayerChoices();
        }
        if (!isDryRun && storyStart && !runtime.activeStoryGenerationId) {
            runtime.activeStoryGenerationId = `story:pending:${Date.now().toString(36)}`;
            runtime.announceStoryState?.(true);
        }
        // The prompt-ready hook claims the story slot and needs to know
        // whether this is a quiet generation, which it is not told.
        if (!isDryRun) runtime.storyGenerationType = generationType;
        runtime.userStoppedGenerationAt = 0;
        runtime.storyGenerationBlock = null;
        runtime.blockedGenerationCancellation = false;
        const storyGeneration = !['quiet', 'impersonate'].includes(generationType);
        if (!isDryRun && storyGeneration) {
            // The reply being replaced or continued is no longer read.
            stopSpeaking();
            beginTurnActions(generationType);
        }
        // Fold the just-sent player turn into the SQLite narrative log before
        // prompt assembly so the history section inside the macro is current.
        if (!isDryRun && storyGeneration) syncNarrativeLog();
        // Swap SillyTavern's Main Prompt for the plugin-owned narrator prompt
        // for this story generation. The swap is reverted as soon as the
        // generation finishes, so the user's prompt manager is never mutated
        // on disk — it is simply ignored while the plugin prompt is active.
        // A swap failure must never take the story turn down with it.
        try {
            await applyNarratorPromptSwap(!isDryRun && storyGeneration);
        } catch (swapError) {
            console.error(LOG_PREFIX, 'Narrator prompt swap failed; continuing with the SillyTavern prompt:', swapError);
        }
        if (!isDryRun && storyGeneration) await warnOnInsufficientResponseCap();
        if (!isDryRun && storyGeneration) {
            showNarratorPill('Narrating');
            trackNarrationStreamingStart();
        }
        runtime.storySendPendingAt = 0;
        runtime.activeStoryGenerationId = !isDryRun && storyGeneration
            ? `story:${Date.now().toString(36)}:${(++runtime.storyGenerationSerial).toString(36)}`
            : '';
        if (runtime.activeStoryGenerationId) runtime.announceStoryState?.(true);
        else runtime.announceStoryState?.(false);
        if (!isDryRun && storyGeneration) {
            // Phase 1 architecture: never block the story on InnerLore
            // preparation. Previously this handler awaited a full history
            // rebuild and/or an expression-foundation pass inside SillyTavern's
            // awaited GENERATION_STARTED emit, and aborted any in-flight pass —
            // so a multi-call rebuild (one model call per batch) stalled the
            // send button, and each tap restarted the rebuild so it never
            // finished. Now we only schedule that work in the background,
            // without aborting a running pass, and let the story proceed with
            // the best context available now. The prepared minds/lore improve
            // the next turn instead of wedging this one.
            const store = getChatStore();
            if (store?.needsRebuild) {
                if (getSettings().autoRebuildOnHistoryChange && !runtime.historyRebuildQueued) {
                    runtime.historyRebuildQueued = true;
                    scheduleQueuedHistoryRebuild(0);
                }
            } else if (!expressionFoundationReady(store) && !runtime.foundationPromise) {
                scheduleExpressionFoundationWarmup(0);
            }
        }
        const isContinue = generationType === 'continue';
        const replayingReply = ['regenerate', 'swipe'].includes(generationType);
        updateInjection({ isContinue });
        // Normal sends receive the newest player turn in MESSAGE_SENT. A
        // regenerate/swipe has no MESSAGE_SENT edge, so prepare its selected
        // branch here with a short timeout before prompt assembly continues.
        if (!isDryRun && storyGeneration && (replayingReply || isContinue)) {
            await prepareServerContext({ force: true });
            updateInjection({ isContinue });
        } else {
            void prepareServerContext();
        }
        updateTriggerDeliveryPrompt({
            storyGeneration,
            isContinue,
            // Record every real foreground generation. Normal sends refresh
            // once more at MESSAGE_SENT so time skips and same-reply actions
            // added from the textarea join the same generation receipt.
            recordInjection: !isDryRun,
            attemptMessageIndex: replayingReply ? lastPlayerMessageIndex(context().chat) : undefined,
        });
    });
    if (events.GENERATION_AFTER_COMMANDS) {
        eventSource.on(events.GENERATION_AFTER_COMMANDS, (_generationType, _generationOptions, isDryRun) => {
            const block = runtime.storyGenerationBlock;
            if (isDryRun || !block || block.chatId !== currentChatId()) return;
            runtime.blockedGenerationCancellation = true;
            runtime.userStoppedGenerationAt = Date.now();
            const stopped = context().stopGeneration?.();
            if (!stopped) {
                console.error(LOG_PREFIX, 'SillyTavern did not expose an active generation controller for the blocked story request.');
            }
        });
    }
    if (events.CHAT_COMPLETION_SETTINGS_READY) {
        // SillyTavern drops top_k, min_p and the preset's custom body on the
        // custom source unless the preset is bound to the connection. A story
        // on Featherless or NovelAI gets them here.
        eventSource.on(events.CHAT_COMPLETION_SETTINGS_READY, generateData => {
            try {
                const settings = getSettings();
                if (!settings.enabled || !generateData || generateData.chat_completion_source !== 'custom' || !runtime.storyRequestInFlight) return;
                const ctx = context();
                const provider = limitedHost(generateData.custom_url || ctx.chatCompletionSettings?.custom_url);
                const lines = storyProviderBodyLines(provider, generateData.custom_include_body, ctx.chatCompletionSettings || {}, settings.storyProviderBody);
                if (!lines.length) return;
                const existing = String(generateData.custom_include_body || '').trim();
                generateData.custom_include_body = `${existing}${existing ? '\n' : ''}${lines.join('\n')}`;
                log(`Story request body for ${provider}: +${lines.join(' / ')}`);
            } catch (error) {
                console.warn(`${LOG_PREFIX} story request body:`, error);
            }
        });
    }
    if (events.CHAT_COMPLETION_PROMPT_READY) {
        // Derived mode (and explicit history-in-macro) delivers the curated
        // packet - including history - from the state macro, so SillyTavern's
        // own rendered conversation turns must not also ship: history is
        // delivered exactly once and no tokens are doubled up. System-role
        // prompt entries and the live player turn always stay.
        eventSource.on(events.CHAT_COMPLETION_PROMPT_READY, async prompt => {
            const settings = getSettings();
            if (!settings.enabled || !runtime.activeStoryGenerationId) return;
            await departStory(settings, packetBefore => refreshPacketInPrompt(prompt, packetBefore));
            if (!runtime.derivedContext) return;
            // SillyTavern 1.18 passes { chat }; older builds passed { messages }.
            // The array must be mutated in place - reassignment is ignored.
            const messages = Array.isArray(prompt?.chat)
                ? prompt.chat
                : (Array.isArray(prompt?.messages) ? prompt.messages : null);
            if (!messages || messages.length < 2) return;
            let firstAssistant = -1;
            let lastUser = -1;
            for (let i = 0; i < messages.length; i++) {
                const role = messages[i]?.role;
                const content = String(messages[i]?.content ?? '').trim();
                if (role === 'assistant' && firstAssistant === -1 && content) firstAssistant = i;
                if (role === 'user' && content) lastUser = i;
            }
            const keep = new Set();
            for (let i = 0; i < messages.length; i++) {
                if (
                    messages[i]?.role === 'system'
                    // The live turn and anything after it: the tool calls and
                    // their results that a follow-up generation narrates.
                    || i >= lastUser
                    || (firstAssistant > -1 && i < firstAssistant && messages[i]?.role === 'user')
                ) keep.add(i);
            }
            if (keep.size === messages.length) return;
            const removed = messages.length - keep.size;
            for (let i = messages.length - 1; i >= 0; i--) {
                if (!keep.has(i)) messages.splice(i, 1);
            }
            log(`History bypass: delivering history once via the state macro (${removed} rendered turns removed from this request).`);
        });
    }
    if (events.GENERATE_AFTER_COMBINE_PROMPTS) {
        // Text completion: the same departure as a chat story; the assembled
        // prompt string then carries the freshest note and memory.
        eventSource.on(events.GENERATE_AFTER_COMBINE_PROMPTS, async data => {
            const settings = getSettings();
            if (!settings.enabled || data?.dryRun || typeof data?.prompt !== 'string' || !runtime.activeStoryGenerationId) return;
            const memoryBefore = runtime.lastTextMemory || '';
            await departStory(settings, packetBefore => {
                data.prompt = refreshTextPrompt(data.prompt, packetBefore, memoryBefore);
            });
        });
    }
    if (events.GENERATION_ENDED) {
        eventSource.on(events.GENERATION_ENDED, () => {
            // The swapped main prompt must never outlive the reply: a settings
            // save between turns would otherwise persist it into the preset.
            restoreNarratorPromptSwap();
            if (runtime.pendingTextToolCalls) void finishTextToolCalls();
            else setTimeout(liveAfterReply, 1_200);
            if (runtime.storyRequestInFlight) {
                runtime.storyRequestInFlight = false;
                runtime.announceStoryState?.(false);
            }
        });
    }
    if (events.GENERATION_STOPPED) {
        eventSource.on(events.GENERATION_STOPPED, () => {
            if (runtime.storyRequestInFlight) {
                runtime.storyRequestInFlight = false;
                runtime.announceStoryState?.(false);
            }
            runtime.storySendPendingAt = 0;
            if (runtime.activeStoryGenerationId) {
                runtime.activeStoryGenerationId = '';
                runtime.announceStoryState?.(false);
            }
            hideNarratorPill();
            restoreNarratorPromptSwap();
            syncNarrativeLog();
            runtime.userStoppedGenerationAt = Date.now();
            const blockedCancellation = runtime.blockedGenerationCancellation;
            runtime.blockedGenerationCancellation = false;
            runtime.storyGenerationBlock = null;
            if (runtime.deferHistoryRebuild) {
                runtime.deferHistoryRebuild = false;
                runtime.historyRebuildQueued = true;
                scheduleQueuedHistoryRebuild(250);
            }
            if (blockedCancellation) updateUI();
        });
    }
    eventSource.on(events.CHAT_CHANGED, async () => {
        updateCastCards();
        restoreNarratorPromptSwap();
        syncNarrativeLog();
        runtime.controller?.abort();
        clearAnalysisRetry();
        clearTimeout(runtime.historyTimer);
        runtime.historyTimer = null;
        clearTimeout(runtime.foundationTimer);
        runtime.foundationTimer = null;
        runtime.afterStory.clear();
        runtime.historyRebuildQueued = false;
        runtime.historyRevision = 0;
        runtime.queued = false;
        runtime.storyGenerationBlock = null;
        runtime.blockedGenerationCancellation = false;
        clearHistoryFallback();
        // Extension prompts are global runtime entries rather than chat-owned
        // values. Clear both keys before rebuilding them for the newly opened
        // chat so an empty chat cannot inherit the prior chat's context.
        context().setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0);
        context().setExtensionPrompt(TURN_CONTRACT_PROMPT_KEY, '', 1, 0, false, 0);
        context().setExtensionPrompt(TRIGGER_DELIVERY_PROMPT_KEY, '', 1, 0, false, 0);
        context().setExtensionPrompt(TEXT_MEMORY_PROMPT_KEY, '', 0, 0, false, 0);
        runtime.lastTextMemory = '';
        runtime.lastInjection = '';
        runtime.lastTurnContract = '';
        runtime.lastTriggerDeliveryPrompt = '';
        runtime.activeStoryGenerationId = '';
        try {
            await loadChatStore();
        } catch (error) {
            setStatus('error', 'Storage unavailable', runtime.storageError || 'The server-side InnerLore store could not be opened.');
            updateUI();
            toastr.error(`InnerLore could not open its SQLite store: ${error.message || error}`, DISPLAY_NAME, { timeOut: 0 });
            return;
        }
        setStatus('idle', 'Idle', currentChatId() ? 'Ready for the next story reply.' : 'Waiting for a chat.');
        updateUI();
        void adoptPortraits();
        // Prime the compiled packet (and the cast cards' scene participants)
        // before the first generation of the session, so the world state is
        // visible and injected from the moment a saved chat opens.
        if (getSettings().enabled && getChatStore()) updateInjection({});
        updateCastCards();
        void prepareServerContext();
        if (scheduleRequestedRecoveryOnLoad()) {
            // Recovery queues one complete analysis pass after stitching.
        } else if (getChatStore()?.needsRebuild && getSettings().autoRebuildOnHistoryChange) {
            runtime.historyRebuildQueued = true;
            scheduleQueuedHistoryRebuild(250);
        } else if (getSettings().autoUpdate && pendingAnalysisState().pending) {
            setTimeout(() => processPending({ force: true, silent: true }), 250);
        } else if (!expressionFoundationReady(getChatStore())) {
            scheduleExpressionFoundationWarmup(250);
        }
    });
    const scheduleExternalHistoryRebuild = () => {
        // Regenerate removes the empty placeholder and Continue may update its
        // swipe internally. Those are part of one recovery transaction, not a
        // user-selected branch change.
        if (!runtime.cutoffRecovery) scheduleHistoryRebuild();
    };
    const scheduleSwipeHistoryRebuild = messageIndex => {
        if (!runtime.cutoffRecovery) scheduleHistoryRebuild({ promptFallbackIndex: messageIndex });
    };
    eventSource.on(events.MESSAGE_EDITED, scheduleExternalHistoryRebuild);
    eventSource.on(events.MESSAGE_SWIPED, scheduleSwipeHistoryRebuild);
    eventSource.on(events.MESSAGE_SWIPED, messageIndex => {
        captureReplyChoices(messageIndex);
        renderPlayerChoices();
    });
    for (const event of [events.CHARACTER_MESSAGE_RENDERED, events.MESSAGE_SENT, events.MESSAGE_DELETED]) {
        if (event) eventSource.on(event, () => renderPlayerChoices());
    }
    for (const event of [events.CHARACTER_MESSAGE_RENDERED, events.CHAT_CHANGED, events.MESSAGE_SWIPED, events.MORE_MESSAGES_LOADED]) {
        if (event) eventSource.on(event, () => setTimeout(ensureVoiceButtons, 0));
    }
    if (events.CHAT_CHANGED) eventSource.on(events.CHAT_CHANGED, () => {
        stopSpeaking();
        ensureMicButton();
    });
    if (events.STREAM_TOKEN_RECEIVED) eventSource.on(events.STREAM_TOKEN_RECEIVED, text => voiceStreamProgress(text));
    for (const event of [events.MESSAGE_SWIPED, events.MESSAGE_DELETED, events.MESSAGE_SENT, events.GENERATION_STOPPED]) {
        if (event) eventSource.on(event, () => stopSpeaking());
    }
    for (const event of [events.GENERATION_ENDED, events.GENERATION_STOPPED]) {
        if (event) eventSource.on(event, () => {
            runtime.choicesHidden = false;
            renderPlayerChoices();
        });
    }
    eventSource.on(events.MESSAGE_DELETED, scheduleExternalHistoryRebuild);
    if (events.CHAT_DELETED) {
        eventSource.on(events.CHAT_DELETED, async chatId => {
            await cleanupDeletedChat(chatId);
        });
    }
    if (events.GROUP_CHAT_DELETED) {
        eventSource.on(events.GROUP_CHAT_DELETED, async chatId => {
            await cleanupDeletedChat(chatId);
        });
    }
    if (events.CHAT_RENAMED) {
        eventSource.on(events.CHAT_RENAMED, async ({ oldFileName, newFileName } = {}) => {
            migrateLorebookRegistry(oldFileName, newFileName);
            try {
                await migrateStorageRegistry(oldFileName, newFileName);
            } catch (error) {
                console.error(`${LOG_PREFIX} Could not rename the SQLite chat world:`, error);
                toastr.warning('The chat was renamed, but InnerLore storage could not update its chat identity yet.', DISPLAY_NAME);
            }
            try {
                await migratePortraits(oldFileName, newFileName);
            } catch (error) {
                console.warn(`${LOG_PREFIX} Could not move the portraits of the renamed chat (the next start will tidy the old files):`, error);
            }
        });
    }
}

async function initializeServerState() {
    try {
        await loadChatStore();
    } catch (error) {
        // Keep chat-change retries available after a failed initial open, but
        // do not expose generation handlers to a half-loaded store.
        registerEvents();
        setStatus('error', 'Storage unavailable', runtime.storageError || 'The server-side InnerLore store could not be opened.');
        updateUI();
        toastr.error(`InnerLore could not open its SQLite store: ${error.message || error}`, DISPLAY_NAME, { timeOut: 0 });
        return;
    }
    registerEvents();

    if (Object.keys(getSettings().pendingChatCleanups).length
        || Object.keys(getSettings().pendingStorageCleanups).length) {
        try {
            await retryPendingChatCleanups();
        } catch (error) {
            console.error(`${LOG_PREFIX} Deferred cleanup retry failed:`, error);
        }
    }
    try {
        runtime.lastOrphanSweep = await sweepOrphanedChatState();
    } catch (error) {
        console.warn(`${LOG_PREFIX} Orphan sweep skipped:`, error);
    }
    void adoptPortraits();
    updateInjection();
    void prepareServerContext();
    setStatus('idle', 'Idle', currentChatId() ? 'Ready for the next story reply.' : 'Waiting for a chat.');
    updateUI();
    if (scheduleRequestedRecoveryOnLoad()) {
        // Recovery queues one complete analysis pass after stitching.
    } else if (getChatStore()?.needsRebuild && getSettings().autoRebuildOnHistoryChange) {
        runtime.historyRebuildQueued = true;
        scheduleQueuedHistoryRebuild(250);
    } else if (getSettings().autoUpdate && pendingAnalysisState().pending) {
        setTimeout(() => processPending({ force: true, silent: true }), 250);
    } else if (!expressionFoundationReady(getChatStore())) {
        scheduleExpressionFoundationWarmup(250);
    }
    console.log(`${LOG_PREFIX} v${EXTENSION_VERSION} loaded with prepared SQLite narrative state, prompt macros, and verified trigger-event delivery.`);
}

function initializeServerStateAfterAppReady(ctx) {
    const events = ctx.eventTypes || ctx.event_types;
    const start = () => {
        if (runtime.serverInitializationStarted) return;
        runtime.serverInitializationStarted = true;
        // Deliberately do not return this promise. SillyTavern awaits APP_READY
        // listeners, while SQLite/LadybugDB availability is optional for the
        // application shell and must never hold its loading overlay open.
        runtime.serverInitializationPromise = initializeServerState().catch(error => {
            console.error(LOG_PREFIX, 'Deferred server-state initialization failed:', error);
            setStatus('error', 'Initialization failed', error?.message || String(error));
            updateUI();
        });
    };

    if (events?.APP_READY) ctx.eventSource.on(events.APP_READY, start);
    // The fork's shell publishes itself after extensions initialise; wire up then.
    if (events?.APP_READY) ctx.eventSource.on(events.APP_READY, () => applyShellIntegration());
    else queueMicrotask(start);
    // Story and background work commonly share one provider, and many
    // providers serve a single concurrent request. Background passes wait for
    // any active story generation to finish instead of racing it into a
    // provider-side "concurrent generation is locked" rejection.
    setStoryIdleGate(async signal => {
        // Serialized scheduling, background-first: background work runs ahead
        // of the story whenever both are pending, and only defers to a story
        // request that is actually streaming (not one still waiting behind
        // background work - that ordering is the whole point). Peer stories
        // still block, with a staleness expiry so a dead tab cannot wedge it.
        // With two provider slots, llm-client skips this gate altogether.
        while (!signal?.aborted && (storyClaimFresh()
            || Boolean(runtime.peerStoryActiveAt && Date.now() - runtime.peerStoryActiveAt < 120_000))) {
            await new Promise(resolve => setTimeout(resolve, 1_000));
        }
        releaseStaleStoryClaim();
    });
    // Provider-level serialization must hold across SillyTavern tabs: a stale
    // second tab runs its own InnerLore work against the same single-request
    // provider. BroadcastChannel coordinates story/background state between
    // tabs; peer facts carry timestamps so a crashed tab cannot wedge the
    // gates open forever.
    if (typeof BroadcastChannel === 'function' && !runtime.providerLockChannel) {
        runtime.providerLockChannel = new BroadcastChannel('innerlore_provider_lock');
        // Node's BroadcastChannel keeps the event loop alive, which would hang
        // non-browser hosts (tests, the server plugin entry). Browsers have no
        // unref; Node gets it so the channel never blocks shutdown.
        runtime.providerLockChannel.unref?.();
        runtime.peerStoryActiveAt = 0;
        runtime.peerBackgroundCount = 0;
        runtime.providerLockChannel.onmessage = event => {
            const data = event?.data || {};
            if (data.kind === 'story') {
                runtime.peerStoryActiveAt = data.active ? Date.now() : 0;
            } else if (data.kind === 'background') {
                runtime.peerBackgroundCount = Math.max(0, Number(data.count) || 0);
                runtime.peerBackgroundAt = runtime.peerBackgroundCount > 0 ? Date.now() : 0;
                setPeerBackgroundInFlight(runtime.peerBackgroundCount > 0
                    && Date.now() - (runtime.peerBackgroundAt || 0) < 600_000 ? 1 : 0);
            }
        };
        const announce = payload => {
            try { runtime.providerLockChannel?.postMessage(payload); } catch { /* channel closed */ }
        };
        runtime.announceStoryState = active => announce({ kind: 'story', active });
        setSlotListener((scope, count) => {
            if (scope === 'own') announce({ kind: 'background', count });
        });
    }
}

// Dual-mode entry: this file is the browser extension AND, when SillyTavern's
// plugin loader imports it from plugins/, the server plugin. Browser startup
// must not run under Node, and Node must not touch browser globals. The
// Node-side loader defines neither `window` nor a `SillyTavern` global (the
// bundled storage plugin uses only node: modules), while every browser-like
// environment — real or the extension's Node test mocks — defines at least
// one of them.
const RUNNING_IN_BROWSER = typeof window !== 'undefined' || typeof SillyTavern !== 'undefined';

if (RUNNING_IN_BROWSER) (async function init() {
    try {
        const ctx = context();
        getSettings();
        registerContextMacros();
        registerGameTools();
        const html = await ctx.renderExtensionTemplateAsync('third-party/SillyTavern-InnerLore', 'settings', {});
        $('#extensions_settings2').append(html);
        applyShellIntegration();
        populateProfiles();
        applySettingsToUI();
        bindUIEvents();
        ensureToolCallingSetup();
        migrateVoiceDefaults();
        bindVoiceButtons();
        ensureMicButton();
        ensureVoiceTagRegex();
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && voiceInputState().live) setLiveMode(false);
            });
        }
        if (getSettings().voiceLive) getSettings().voiceLive = false;
        void probeVoiceServer({ force: true }).then(() => ensureVoiceButtons());
        registerSlashCommands();
        initializeServerStateAfterAppReady(ctx);
        console.log(`${LOG_PREFIX} UI loaded; server-side Auto Lore initialization is deferred until SillyTavern is ready.`);
    } catch (error) {
        console.error(LOG_PREFIX, 'Initialization failed:', error);
        toastr.error(`InnerLore failed to load: ${error.message || error}`, DISPLAY_NAME, { timeOut: 0 });
    }
})();

// ---- Server-plugin facade -------------------------------------------------
// SillyTavern's plugin loader imports plugins/<name>/index.js and calls
// init(router, args). When this repository is cloned or linked into
// plugins/, these exports delegate to the bundled SQLite storage plugin
// without affecting browser loading (the dynamic import only runs in Node).

export const info = {
    id: 'innerlore-storage',
    name: 'InnerLore Storage',
    description: 'Lean SQLite persistence for the InnerLore extension (bundled in the SillyTavern-InnerLore repository).',
};

export async function init(router, args) {
    if (RUNNING_IN_BROWSER) return;
    const plugin = await import('./server/innerlore-storage/index.js');
    return plugin.init(router, args);
}

export async function exit() {
    if (RUNNING_IN_BROWSER) return;
    const plugin = await import('./server/innerlore-storage/index.js');
    return plugin.exit();
}
