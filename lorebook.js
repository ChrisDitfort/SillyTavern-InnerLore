import { cleanString, hashString, renderLoreContent } from './core.js';

const AUTOMATION_ID = 'inner-lore-v1';
const LOREBOOK_OWNER_KEY = 'innerLore';

function context() {
    return SillyTavern.getContext();
}

function slug(value, fallback = 'Story') {
    const text = cleanString(value, 100)
        .replace(/[^\p{L}\p{N} _-]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    return (text || fallback).slice(0, 60).trim();
}

export function deriveLorebookName(chatId, characterName = '') {
    const label = slug(characterName || String(chatId).replace(/\.[^.]+$/, ''), 'Story');
    return `InnerLore - ${label} - ${hashString(chatId || label)}`;
}

function markLorebookOwnership(data, chatId) {
    data.extensions = data.extensions && typeof data.extensions === 'object' ? data.extensions : {};
    const current = data.extensions[LOREBOOK_OWNER_KEY];
    const next = {
        version: 1,
        managed: true,
        chatId: cleanString(chatId, 300),
    };
    const changed = !current
        || current.version !== next.version
        || current.managed !== next.managed
        || cleanString(current.chatId, 300) !== next.chatId;
    data.extensions[LOREBOOK_OWNER_KEY] = next;
    return changed;
}

function isLorebookOwnedByChat(data, chatId) {
    const owner = data?.extensions?.[LOREBOOK_OWNER_KEY];
    return owner?.managed === true && cleanString(owner.chatId, 300) === cleanString(chatId, 300);
}

function nextUid(data) {
    const ids = Object.keys(data.entries || {})
        .map(Number)
        .filter(Number.isInteger);
    return ids.length ? Math.max(...ids) + 1 : 0;
}

function createEntry(data) {
    const uid = nextUid(data);
    const entry = {
        uid,
        key: [],
        keysecondary: [],
        comment: '',
        content: '',
        constant: false,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: 100,
        position: 0,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: true,
        depth: 4,
        outletName: '',
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: AUTOMATION_ID,
        role: 0,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
        extensions: {},
    };
    data.entries[uid] = entry;
    return entry;
}

function recordIdFromEntry(entry) {
    return cleanString(entry?.extensions?.innerLore?.recordId, 300);
}

function findEntry(data, record) {
    if (record.entryUid !== null && record.entryUid !== undefined && data.entries?.[record.entryUid]) {
        return data.entries[record.entryUid];
    }
    return Object.values(data.entries || {}).find(entry => recordIdFromEntry(entry) === record.id)
        || Object.values(data.entries || {}).find(entry => (
            entry.automationId === AUTOMATION_ID
            && cleanString(entry.comment).toLocaleLowerCase() === `[innerlore/${record.type}] ${record.name}`.toLocaleLowerCase()
        ));
}

export async function ensureLorebook(store, options = {}) {
    const ctx = context();
    const chatId = cleanString(options.chatId || store.chatId, 300);
    if (!store.lorebookName) {
        store.lorebookName = deriveLorebookName(chatId, options.characterName);
    }
    let data = await ctx.loadWorldInfo(store.lorebookName);
    let shouldSave = false;
    if (!data) {
        data = { entries: {} };
        shouldSave = true;
    }
    if (!data.entries || typeof data.entries !== 'object') data.entries = {};
    shouldSave = markLorebookOwnership(data, chatId) || shouldSave;
    if (shouldSave) {
        await ctx.saveWorldInfo(store.lorebookName, data, true);
        await ctx.updateWorldInfoList();
    }
    return { name: store.lorebookName, data };
}

/**
 * Mirror structured entity records into an extension-owned native World Info
 * book. A manual edit to entry content is detected and preserved as an override.
 */
export async function syncLorebook(store, options = {}) {
    const { name, data } = await ensureLorebook(store, options);
    const records = Object.values(store.entities || {});
    const liveIds = new Set(records.map(record => record.id));
    let created = 0;
    let updated = 0;
    let removed = 0;
    let manualEditsDetected = 0;

    for (const record of records) {
        let entry = findEntry(data, record);
        if (!entry) {
            entry = createEntry(data);
            created++;
        } else {
            updated++;
            const currentHash = hashString(entry.content || '');
            if (!record.manualOverride && record.renderedHash && currentHash !== record.renderedHash) {
                record.manualOverride = true;
                record.manualContent = cleanString(entry.content, 20_000);
                manualEditsDetected++;
            }
        }

        const content = renderLoreContent(record);
        const keys = [...new Set([record.name, ...(record.aliases || []), ...(record.keys || [])]
            .map(value => cleanString(value, 160))
            .filter(Boolean))]
            .slice(0, 30);
        entry.key = keys;
        entry.keysecondary = [];
        entry.comment = `[InnerLore/${record.type}] ${record.name}`;
        entry.content = content;
        entry.constant = Boolean(record.pinned);
        entry.selective = false;
        entry.addMemo = true;
        entry.order = 100 + Math.round(Number(record.importance) || 0);
        entry.disable = record.enabled === false;
        entry.automationId = AUTOMATION_ID;
        entry.extensions = entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
        entry.extensions.innerLore = {
            version: 1,
            recordId: record.id,
            type: record.type,
            managed: true,
            chatId: cleanString(options.chatId || store.chatId, 300),
        };
        record.entryUid = entry.uid;
        record.renderedHash = hashString(content);
    }

    if (options.removeMissing) {
        for (const [uid, entry] of Object.entries(data.entries)) {
            const managedId = recordIdFromEntry(entry);
            if (entry.automationId === AUTOMATION_ID && managedId && !liveIds.has(managedId)) {
                delete data.entries[uid];
                removed++;
            }
        }
    }

    await context().saveWorldInfo(name, data, true);
    return { name, created, updated, removed, manualEditsDetected };
}

export async function removeLoreRecord(store, recordId) {
    const record = store.entities?.[recordId];
    if (!record) return false;
    const { name, data } = await ensureLorebook(store);
    const entry = findEntry(data, record);
    if (entry) delete data.entries[entry.uid];
    delete store.entities[recordId];
    await context().saveWorldInfo(name, data, true);
    return true;
}

export async function openInnerLorebook(store, options = {}) {
    const { name } = await ensureLorebook(store, options);
    const module = await import('../../../world-info.js');
    if (typeof module.openWorldInfoEditor !== 'function') {
        throw new Error('SillyTavern World Info editor API is unavailable.');
    }
    module.openWorldInfoEditor(name);
    return name;
}

/**
 * Delete every extension-owned World Info book associated with a deleted chat.
 * The generated-name hash supports books created before ownership metadata was
 * introduced. Explicit names cover a book retained across a chat rename.
 *
 * @param {string} chatId Deleted SillyTavern chat id (filename without .jsonl)
 * @param {object} [options] Test seams and remembered names
 * @param {string[]} [options.registeredNames] Previously recorded book names
 * @param {string[]} [options.worldInfoNames] Available World Info names
 * @param {(name: string) => Promise<object|null>} [options.loadWorldInfo] World Info loader
 * @param {(name: string) => Promise<boolean>} [options.deleteWorldInfo] World Info deleter
 * @returns {Promise<{candidates: string[], deleted: string[], failed: string[]}>}
 */
export async function deleteInnerLorebooksForChat(chatId, options = {}) {
    const normalizedChatId = cleanString(chatId, 300);
    if (!normalizedChatId) return { candidates: [], deleted: [], failed: [] };

    const ctx = context();
    const knownNames = Array.isArray(options.worldInfoNames)
        ? options.worldInfoNames
        : (ctx.getWorldInfoNames?.() || []);
    const registeredNames = (Array.isArray(options.registeredNames) ? options.registeredNames : [])
        .map(name => cleanString(name, 180))
        .filter(Boolean);
    const registeredNameSet = new Set(registeredNames);
    const names = [...new Set([...knownNames, ...registeredNames]
        .map(name => cleanString(name, 180))
        .filter(Boolean))];
    const expectedSuffix = ` - ${hashString(normalizedChatId)}`;
    const loadWorldInfo = options.loadWorldInfo || ctx.loadWorldInfo?.bind(ctx);
    const candidates = new Set();

    for (const name of names) {
        const generatedNameMatch = name.startsWith('InnerLore - ') && name.endsWith(expectedSuffix);
        const explicitlyRegistered = registeredNameSet.has(name);
        if (generatedNameMatch) {
            candidates.add(name);
            continue;
        }

        // Registered names may already have been removed during a previous
        // attempt. Only retry them when they still exist.
        let data = null;
        try {
            data = typeof loadWorldInfo === 'function' ? await loadWorldInfo(name) : null;
        } catch {
            if (explicitlyRegistered) candidates.add(name);
            continue;
        }
        if (isLorebookOwnedByChat(data, normalizedChatId) || (explicitlyRegistered && data)) {
            candidates.add(name);
        }
    }

    if (!candidates.size) return { candidates: [], deleted: [], failed: [] };
    let deleteWorldInfo = options.deleteWorldInfo;
    if (typeof deleteWorldInfo !== 'function') {
        const module = await import('../../../world-info.js');
        deleteWorldInfo = module.deleteWorldInfo;
    }
    if (typeof deleteWorldInfo !== 'function') {
        return { candidates: [...candidates], deleted: [], failed: [...candidates] };
    }

    const deleted = [];
    const failed = [];
    for (const name of candidates) {
        try {
            if (await deleteWorldInfo(name)) deleted.push(name);
            else failed.push(name);
        } catch {
            failed.push(name);
        }
    }
    return { candidates: [...candidates], deleted, failed };
}
