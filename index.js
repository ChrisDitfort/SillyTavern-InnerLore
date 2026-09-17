import {
    applyStoreCheckpoint,
    alignExplicitLocationOperations,
    brainPsychologyCount,
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
    mergeEntityOperations,
    mergeMindOperations,
    messageFingerprint,
    normalizeBrainRecord,
    normalizeStore,
    recordCheckpoint,
    refreshMentionRecency,
    renderLoreContent,
    selectResumeCheckpoint,
    snapshotMessageRange,
    summaryceptionRecallText,
    uniqueStrings,
} from './core.js?v=40';
import { compileContext } from './context-compiler.js?v=4';
import {
    applyContextProfileToSettings,
    approximateContextTokens,
    BUILTIN_CONTEXT_PROFILES,
    CONTEXT_CONFIGURATION_VERSION,
    contextConfigurationFingerprint,
    contextProfileById,
    contextProfileOverrides,
    markContextConfigurationCustom,
    setCustomContextMaximum,
} from './context-config.js';
import { collectRecentStoryExpressions } from './expression-cooldown.js';
import {
    chooseDefaultProfileId,
    isTransientRequestError,
    listConnectionProfiles,
    requestJsonPatch,
    testInnerLoreConnection,
} from './llm-client.js?v=8';
import {
    deleteInnerLorebooksForChat,
    openInnerLorebook,
    removeLoreRecord,
    syncLorebook as syncNativeLorebook,
} from './lorebook.js';
import { buildAnalysisMessages, formatCharacterCard, formatTranscript } from './prompts.js';
import { compileTriggerEventDeliveryPreview } from './event-delivery.js?v=2';
import { requestEventDirectorProposal } from './event-director-client.js';
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
} from './event-director.js';
import { decideInnerLoreMaintenance } from './maintenance-scheduler.js?v=4';
import { EmbeddedStorageClient } from './embedded-storage.js?v=1';
import { requestProgressionPatch, testProgressionConnection } from './progression-client.js';
import { buildProgressionMessages } from './progression-prompts.js';
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
const DISPLAY_NAME = 'InnerLore';
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

[INNERLORE GAME STATE — private narrator background; never quote or mention it verbatim]
{{innerlore_state_context}}
[/INNERLORE GAME STATE]

Full player agency is absolute:
- Never write {{user}}'s actions, dialogue, decisions, or inner thoughts — not even small ones, and not even involuntary reactions (expressions, glances, posture, breath, frowns, blushes).
- Never describe {{user}}'s body or face as doing anything. Other characters may NOTICE or GUESS at {{user}}'s demeanor, but only as their own uncertain interpretation, never as established fact.
- EXCEPTION — declared actions: {{user}}'s messages may state actions in second person ("You take the writ", "I sit on the step"). Treat every such action as COMPLETED FACT the instant it is declared: narrate its immediate effect on the world and everyone's reactions, never stall it, re-stage it, hand it back, or await confirmation of it.

PERSPECTIVE CONTRACT (overrides precedent):
- The narration camera never leaves {{user}}. If earlier replies in this chat followed another character's scene or private thoughts, that was drift — do not imitate it; return the camera to {{user}} from this turn onward.
- When {{user}} speaks to a messenger, sends a letter or reply, gives an order, or delegates ("see to it", "handle this"), the delivery, the recipient's reaction, and everything beyond {{user}}'s immediate perception happen OFF SCREEN this turn. Never narrate the messenger's journey, the recipient receiving or reading the message, or any character's private thoughts in a place {{user}} is not.
- Even when the character card centers one character, that centers their role in events — never the narration's viewpoint.
- Narrate only what {{user}} can perceive right now; close-range NPC dialogue and visible reactions are fine. The turn ends awaiting {{user}}'s next move.`;

/** Pending main-prompt restoration after a plugin-prompt generation. */
let narratorPromptRestore = null;
async function scriptModule() {
    return import('/script.js');
}

async function findMainPromptEntry() {
    const oaiModule = await import('/scripts/openai.js');
    const prompts = oaiModule.oai_settings?.prompts;
    if (!Array.isArray(prompts)) return null;
    return prompts.find(prompt => prompt?.identifier === 'main') || null;
}

const NARRATION_LENGTH_DIRECTIVES = Object.freeze({
    brief: 'Narration length: keep this reply brief — one tight paragraph of at most roughly 120 words. Favor one clear beat, then stop.',
    standard: 'Narration length: aim for roughly 250-400 words — two to four paragraphs covering a complete beat with sensory texture.',
    long: 'Narration length: write a long, immersive reply of roughly 500-800 words — several paragraphs, layered detail, room for the scene to breathe.',
});

async function applyNarratorPromptSwap(shouldApply) {
    const settings = getSettings();
    if (narratorPromptRestore) {
        const { entry, content } = narratorPromptRestore;
        narratorPromptRestore = null;
        if (entry) entry.content = content;
    }
    if (!shouldApply) return;
    if (!settings.enabled || !settings.narratorPromptEnabled) return;
    const template = cleanString(settings.narratorPromptTemplate, 20_000);
    if (!template.trim()) return;
    const entry = await findMainPromptEntry();
    if (entry) {
        narratorPromptRestore = { entry, content: entry.content };
        const lengthDirective = NARRATION_LENGTH_DIRECTIVES[settings.narrationLength];
        entry.content = lengthDirective ? `${template}\n\n${lengthDirective}` : template;
    }
}

function restoreNarratorPromptSwap() {
    if (!narratorPromptRestore) return;
    const { entry, content } = narratorPromptRestore;
    narratorPromptRestore = null;
    if (entry) entry.content = content;
}

/**
 * Floating "Narrating…" indicator shown from generation start until the first
 * story text begins to stream, so the silent first-token wait is legible.
 */
let narratorPillTimer = null;

function narratorPill() {
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
    contextBudgetMode: 'profile',
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
    connectionSource: 'profile',
    connectionProfileId: '',
    fallbackConnectionProfileId: '',
    maximumResponseTokens: 12_000,
    requestTimeoutSeconds: 90,
    requestCircuitBreakerSeconds: 90,
    temperature: 0.15,
    maintenanceOutputFormat: 'dsl',
    repairMalformedJson: true,
    autoRebuildOnHistoryChange: true,
    autoRebuildMessageLimit: 120,
    customInstructions: '',
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
    settings.contextProfileId = cleanString(settings.contextProfileId, 64).toLocaleLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(settings.contextProfileId)) settings.contextProfileId = 'balanced';
    if (!['profile', 'custom'].includes(settings.contextBudgetMode)) settings.contextBudgetMode = 'profile';
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
    log('Cleaned deleted chat state', id, { ...loreResult, storage: storageResult });
    return { ...loreResult, storage: storageResult, storageError: storageError?.message || '' };
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
    const metadataPointer = isInnerLoreStoragePointer(metadataValue) ? metadataValue : null;
    const registeredWorldId = settings.storageRegistry[chatId];
    const registryPointer = registeredWorldId ? {
        backend: 'airpg-storage',
        pointerVersion: 1,
        worldId: registeredWorldId,
        chatId,
    } : null;
    // A mismatched metadata pointer signals a real SillyTavern branch and must
    // win over the registry so the server can fork the source world.
    const pointer = metadataPointer?.chatId && metadataPointer.chatId !== chatId
        ? metadataPointer
        : (registryPointer || metadataPointer);
    const legacyStore = isLegacyInnerLoreStore(metadataValue) ? metadataValue : null;
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
        runtime.storeChatId = chatId;
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

async function saveChatStore() {
    const requestedChatId = currentChatId();
    if (!requestedChatId || !runtime.storageReady || runtime.storeChatId !== requestedChatId) return;
    const operation = async () => {
        if (!runtime.storageReady || runtime.storeChatId !== requestedChatId || !runtime.storageWorldId) return;
        const worldId = runtime.storageWorldId;
        const expectedRevision = runtime.storageRevision;
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
                sources: directorContext.sources,
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

function registerContextMacros() {
    const register = context().registerMacro;
    if (typeof register !== 'function') {
        console.warn(`${LOG_PREFIX} SillyTavern does not expose macro registration; automatic context injection remains available.`);
        return;
    }
    for (const macroName of Object.keys(INNERLORE_CONTEXT_MACROS)) {
        register(macroName, () => {
            const settings = context().extensionSettings?.[MODULE_KEY] || defaultSettings;
            let value = macroContextValue(macroName, {
                enabled: settings.enabled,
                deliveryMode: settings.contextDeliveryMode,
                prepared: runtime.preparedContext,
                local: runtime.localContext,
                key: runtime.activeContextKey,
            });
            // The full-state macro also carries the SQLite-backed narrative
            // history so story context arrives from one plugin-owned source.
            if (macroName === 'innerlore_state_context' && settings.enabled && value) {
                if (settings.historyInMacroEnabled !== false) {
                    const history = buildHistorySection(settings);
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
        compilation = compileContext({
            store: promptStore,
            messages: ctx.chat,
            recentText,
            playerName: ctx.name1,
            currentIndex: ctx.chat.length - 1,
            settings: {
                ...settings,
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
    const contextPacket = !historyFallback && !store?.needsRebuild
        ? selectedContextPacket({
            prepared: runtime.preparedContext,
            local: runtime.localContext,
            key: runtime.activeContextKey,
        })
        : runtime.localContext;
    const deliveryMode = settings.contextDeliveryMode === 'macro' ? 'macro' : 'automatic';
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
    // A continue extends an already-written reply. The latest-turn contract is
    // a "produce THIS reply" directive full of mandatory-outcome and required-
    // expression gates that the existing text already satisfies, so injecting
    // it makes the model emit an immediate stop and append nothing. Suppress it
    // for continuations; the next fresh turn rebuilds it.
    const turnContract = settings.enabled && !isContinue
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
        })
        : '';
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
    const input = document.getElementById('il_context_maximum');
    const value = document.getElementById('il_context_maximum_value');
    const custom = settings.contextBudgetMode === 'custom';
    if (input) {
        input.value = settings.contextMaximumCharacters;
        input.setAttribute('aria-valuetext', `${settings.contextMaximumCharacters} characters`);
    }
    if (value) {
        value.textContent = `${Number(settings.contextMaximumCharacters).toLocaleString()} characters · approximately ${approximateContextTokens(settings.contextMaximumCharacters).toLocaleString()} tokens${custom ? ' · Custom' : ` · ${settings.contextProfileId}`}`;
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
        il_narration_length: settings.narrationLength,
        il_debug: settings.debug,
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

    // These agents commonly share one connection profile. Run them in series
    // so a provider with tight concurrency limits cannot make two background
    // requests race each other. Each result is committed independently below,
    // allowing a successful subsystem to advance even if the other one fails.
    let response = null;
    let curatorError = null;
    if (transcript) {
        try {
            response = await requestJsonPatch(settings, buildAnalysisMessages({
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
                settings,
            }), runtime.controller?.signal);
        } catch (error) {
            curatorError = error;
        }
    }
    if (curatorError?.name === 'AbortError' || runtime.controller?.signal.aborted) throw curatorError;

    let progressionResponse = null;
    let progressionError = null;
    if (progressionTranscript) {
        try {
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
            progressionResponse = await requestProgressionPatch(
                settings,
                progressionMessages,
                runtime.controller?.signal,
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
                },
            );
        } catch (error) {
            progressionError = error;
        }
    }
    if (progressionError?.name === 'AbortError' || runtime.controller?.signal.aborted) throw progressionError;
    if (!messageRangeMatchesSnapshot(ctx.chat, sourceSnapshot)) {
        targetStore.needsRebuild = true;
        const error = new Error('Chat history changed while InnerLore was analyzing it; the stale result was discarded.');
        error.name = 'InnerLoreHistoryChangedError';
        throw error;
    }
    const payload = response?.payload && typeof response.payload === 'object' ? response.payload : {};
    const entityOperations = payload.entities || payload.entity_operations || [];
    const alignedEntityOperations = alignExplicitLocationOperations(targetStore, entityOperations, transcript);
    const playerKey = canonicalNameKey(ctx.name1);
    const mindOperations = (payload.minds || payload.mind_operations || [])
        .filter(operation => !playerKey || canonicalNameKey(operation?.character) !== playerKey);

    const entityResult = response && settings.autoLoreEnabled
        ? mergeEntityOperations(targetStore, alignedEntityOperations, {
            enabledTypes: settings.enabledEntityTypes,
            minimumImportance: settings.minimumImportance,
            maximumOperations: settings.maximumEntitiesPerPass,
            messageIndex: curatorEnd,
        })
        : { created: 0, updated: 0, skipped: alignedEntityOperations.length, changedIds: [] };
    const mindResult = response && settings.innerSelfEnabled
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
    if (response && settings.innerSelfEnabled && structuredFoundationBrains(targetStore).length) {
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

    const curatorSucceeded = !curatorEnabled || !transcript || Boolean(response);
    if (curatorEnabled && curatorStart <= curatorEnd && curatorSucceeded) {
        const curatorSnapshot = snapshotMessageRange(ctx.chat, curatorStart, curatorEnd);
        for (const [index, fingerprint] of Object.entries(curatorSnapshot)) {
            if (fingerprint) targetStore.processedFingerprints[index] = fingerprint;
        }
        targetStore.lastProcessedIndex = Math.max(targetStore.lastProcessedIndex, curatorEnd);
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
        progressionResult: progressionResult?.state?.lastRunStats || null,
        progressionError: progressionError ? cleanString(progressionError.message || String(progressionError), 1_000) : '',
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
        skipped: !response && !progressionResponse,
    };
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
    return `${entities.created || 0} lore entries created, ${entities.updated || 0} updated; ${minds.created || 0} minds created, ${minds.updated || 0} updated${curatorText}${progressionText}${directorText}${codecText}.`;
}

function pendingAnalysisState(store = getChatStore()) {
    const settings = getSettings();
    const messages = context().chat || [];
    const targetIndex = lastCompletedStoryIndex(messages);
    if (!store || targetIndex < 0) return { pending: false, targetIndex };
    const decision = decideInnerLoreMaintenance({ messages, store, settings, targetIndex });
    const curatorDue = (settings.innerSelfEnabled || settings.autoLoreEnabled) && decision.curatorDue;
    const progressionDue = settings.worldProgressionEnabled && decision.progressionDue;
    return {
        pending: curatorDue || progressionDue,
        curatorPending: decision.curatorPendingTurns > 0,
        progressionPending: decision.progressionPendingTurns > 0,
        curatorDue,
        progressionDue,
        targetIndex,
        decision,
    };
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
    if (!failures.length) return;
    const error = new Error(failures.join('; '));
    error.name = 'InnerLoreSubsystemError';
    throw error;
}

async function processPending({ force = false, silent = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled || (!settings.innerSelfEnabled && !settings.autoLoreEnabled && !settings.worldProgressionEnabled)) return;
    if (runtime.processing || runtime.rebuilding || runtime.preparingFoundation) {
        runtime.queued = true;
        return;
    }
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
        if (!force && (!settings.autoUpdate || (!runCurator && !runProgression))) return;

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
    let startIndex = Math.max(0, Math.min(curatorStart, progressionStart));
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
        await saveChatStore();
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
    if (runtime.deferHistoryRebuild) {
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
        runtime.historyFallbackStore = createHistoryPrefixPromptStore(store, options.promptFallbackIndex);
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
    const boundary = context().chat.length;
    const staging = createHistoryPrefixPromptStore(store, boundary);
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
    document.getElementById('il_progression_profile')?.addEventListener('change', event => {
        getSettings().progressionConnectionProfileId = event.target.value;
        saveSettings();
    });
    document.getElementById('il_progression_fallback_profile')?.addEventListener('change', event => {
        getSettings().progressionFallbackConnectionProfileId = event.target.value;
        saveSettings();
    });
    document.getElementById('il_custom_instructions')?.addEventListener('change', event => {
        getSettings().customInstructions = cleanString(event.target.value, 4_000);
        saveSettings();
    });
    document.getElementById('il_progression_custom_instructions')?.addEventListener('change', event => {
        getSettings().progressionCustomInstructions = cleanString(event.target.value, 5_000);
        saveSettings();
    });
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
        queueCompletedAssistantTurn(store);
    });
    eventSource.on(events.GENERATION_STARTED, async (generationType, _generationOptions, isDryRun) => {
        runtime.userStoppedGenerationAt = 0;
        runtime.storyGenerationBlock = null;
        runtime.blockedGenerationCancellation = false;
        const storyGeneration = !['quiet', 'impersonate'].includes(generationType);
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
        if (!isDryRun && storyGeneration) {
            showNarratorPill('Narrating');
            trackNarrationStreamingStart();
        }
        runtime.activeStoryGenerationId = !isDryRun && storyGeneration
            ? `story:${Date.now().toString(36)}:${(++runtime.storyGenerationSerial).toString(36)}`
            : '';
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
    if (events.GENERATION_STOPPED) {
        eventSource.on(events.GENERATION_STOPPED, () => {
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
        restoreNarratorPromptSwap();
        syncNarrativeLog();
        runtime.controller?.abort();
        clearAnalysisRetry();
        clearTimeout(runtime.historyTimer);
        runtime.historyTimer = null;
        clearTimeout(runtime.foundationTimer);
        runtime.foundationTimer = null;
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
    console.log(`${LOG_PREFIX} v0.9.0 loaded with prepared SQLite narrative state, prompt macros, and verified trigger-event delivery.`);
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
    else queueMicrotask(start);
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
        const html = await ctx.renderExtensionTemplateAsync('third-party/SillyTavern-InnerLore', 'settings', {});
        $('#extensions_settings2').append(html);
        populateProfiles();
        applySettingsToUI();
        bindUIEvents();
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
