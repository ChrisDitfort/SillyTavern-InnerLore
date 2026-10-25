/**
 * Patches between two store snapshots.
 *
 * The server owns the store's revisions; the browser and the server's own
 * jobs both change it. Instead of sending the whole document and hoping the
 * revision has not moved, a writer sends what it changed, as path-level
 * operations, and the server applies them onto whatever the current
 * snapshot is. Paths stop at a depth chosen per top-level key so that two
 * writers touching different records never collide, while a record itself
 * is replaced whole (its fields are not independently meaningful). Arrays
 * are always leaves; an array the writer only extended becomes an `append`,
 * so two writers adding journal lines or log entries both keep theirs.
 *
 * Pure: no DOM, no SillyTavern; shared by the browser and the server plugin.
 */

/** How deep paths go under each top-level key; a record below that depth is one leaf. */
export const LEAF_DEPTHS = Object.freeze({
    entities: 2,
    brains: 2,
    progression: 3,
    game: 3,
    portraits: 2,
    pictures: 2,
});
const DEFAULT_LEAF_DEPTH = 1;

/** Arrays that only ever grow at the end; a longer array with the old one as prefix is an append. */
const APPEND_ONLY_TAILS = Object.freeze(['journal', 'narrativeLog', 'history', 'log', 'notes', 'timeline', 'deliveries']);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function same(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null || typeof a !== 'object') return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

export function encodePath(segments) {
    return segments.map(segment => String(segment).replace(/~/gu, '~0').replace(/\//gu, '~1')).join('/');
}

export function decodePath(path) {
    return String(path).split('/').map(segment => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

function leafDepthFor(segments) {
    return LEAF_DEPTHS[segments[0]] ?? DEFAULT_LEAF_DEPTH;
}

function appendOnly(segments) {
    return APPEND_ONLY_TAILS.includes(String(segments[segments.length - 1]));
}

/** Whether `next` is `base` with items added at the end. */
function isPrefix(base, next) {
    if (!Array.isArray(base) || !Array.isArray(next) || next.length <= base.length) return false;
    for (let index = 0; index < base.length; index++) {
        if (!same(base[index], next[index])) return false;
    }
    return true;
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * The operations that turn `base` into `next`:
 * `{ set: {path: value}, del: [path], append: {path: [items]} }`.
 */
export function diffStore(base, next) {
    const patch = { set: {}, del: [], append: {} };
    const init = {};
    const walk = (before, after, segments) => {
        const depth = segments.length;
        const bothObjects = isPlainObject(before) && isPlainObject(after);
        // A branch that did not exist before (a new world's game state, first
        // written by its first pass) is written key by key, and an empty one
        // only where nothing is yet, so what another writer put there
        // meanwhile survives.
        if (depth > 0 && (before === undefined || before === null) && isPlainObject(after) && depth < leafDepthFor(segments)) {
            const keys = Object.keys(after);
            if (!keys.length) init[encodePath(segments)] = {};
            for (const key of keys) walk(undefined, after[key], [...segments, key]);
            return;
        }
        if (depth > 0 && (!bothObjects || depth >= leafDepthFor(segments))) {
            if (same(before, after)) return;
            if (Array.isArray(after) && appendOnly(segments) && (before === undefined || before === null || (Array.isArray(before) && isPrefix(before, after)))) {
                const added = after.slice(Array.isArray(before) ? before.length : 0);
                if (added.length) patch.append[encodePath(segments)] = clone(added);
                else if (!Array.isArray(before)) init[encodePath(segments)] = [];
                return;
            }
            // An empty list where there was none is only made where nothing is yet.
            if (Array.isArray(after) && !after.length && (before === undefined || before === null)) {
                init[encodePath(segments)] = [];
                return;
            }
            if (after === undefined) patch.del.push(encodePath(segments));
            else patch.set[encodePath(segments)] = clone(after);
            return;
        }
        if (!bothObjects) {
            // One side is not an object at a branch level: replace the whole value.
            if (!same(before, after)) {
                if (after === undefined) patch.del.push(encodePath(segments));
                else patch.set[encodePath(segments)] = clone(after);
            }
            return;
        }
        const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
        for (const key of keys) walk(before[key], after[key], [...segments, key]);
    };
    walk(isPlainObject(base) ? base : {}, isPlainObject(next) ? next : {}, []);
    if (Object.keys(init).length) patch.init = init;
    return patch;
}

export function isEmptyPatch(patch) {
    return !patch
        || (Object.keys(patch.set || {}).length === 0
            && (patch.del || []).length === 0
            && Object.keys(patch.append || {}).length === 0
            && Object.keys(patch.init || {}).length === 0);
}

/** A sanitized copy of a patch from the wire: only the four operation kinds, string paths, bounded. */
export function normalizePatch(input) {
    const source = isPlainObject(input) ? input : {};
    const set = {};
    for (const [path, value] of Object.entries(isPlainObject(source.set) ? source.set : {})) {
        if (typeof path === 'string' && path) set[path] = value;
    }
    const del = (Array.isArray(source.del) ? source.del : []).filter(path => typeof path === 'string' && path).slice(0, 10_000);
    const append = {};
    for (const [path, items] of Object.entries(isPlainObject(source.append) ? source.append : {})) {
        if (typeof path === 'string' && path && Array.isArray(items)) append[path] = items;
    }
    // Empty branches to create only where nothing is yet.
    const init = {};
    for (const [path, value] of Object.entries(isPlainObject(source.init) ? source.init : {})) {
        if (typeof path === 'string' && path && (isPlainObject(value) || Array.isArray(value))) init[path] = value;
    }
    return Object.keys(init).length ? { set, del, append, init } : { set, del, append };
}

function container(root, segments, create) {
    let node = root;
    for (const segment of segments) {
        if (!isPlainObject(node[segment])) {
            if (!create) return null;
            node[segment] = {};
        }
        node = node[segment];
    }
    return node;
}

function sameItem(a, b) {
    if (same(a, b)) return true;
    const idOf = item => (isPlainObject(item) ? item.id ?? item.key ?? null : null);
    const ida = idOf(a);
    return ida !== null && ida !== undefined && ida === idOf(b);
}

/**
 * Applies a patch to a snapshot in place and returns it. Deletes first, then
 * sets, then appends; an append skips items the array already ends with (the
 * same append arriving twice) or already holds by id.
 */
export function applyPatch(snapshot, patchInput) {
    const patch = normalizePatch(patchInput);
    const root = isPlainObject(snapshot) ? snapshot : {};
    for (const path of patch.del) {
        const segments = decodePath(path);
        const parent = container(root, segments.slice(0, -1), false);
        if (parent) delete parent[segments[segments.length - 1]];
    }
    for (const [path, value] of Object.entries(patch.init || {})) {
        const segments = decodePath(path);
        const parent = container(root, segments.slice(0, -1), true);
        const key = segments[segments.length - 1];
        if (Array.isArray(value) ? !Array.isArray(parent[key]) : !isPlainObject(parent[key])) parent[key] = clone(value);
    }
    for (const [path, value] of Object.entries(patch.set)) {
        const segments = decodePath(path);
        const parent = container(root, segments.slice(0, -1), true);
        parent[segments[segments.length - 1]] = clone(value);
    }
    for (const [path, items] of Object.entries(patch.append)) {
        const segments = decodePath(path);
        const parent = container(root, segments.slice(0, -1), true);
        const key = segments[segments.length - 1];
        if (!Array.isArray(parent[key])) parent[key] = [];
        const target = parent[key];
        // The same tail arriving again (a retried save) is not appended twice.
        const tail = target.slice(-items.length);
        if (tail.length === items.length && tail.every((item, index) => same(item, items[index]))) continue;
        for (const item of items) {
            if (target.some(existing => sameItem(existing, item))) continue;
            target.push(clone(item));
        }
    }
    return root;
}

/** The paths a patch touches, for deciding what to refresh. */
export function patchPaths(patch) {
    const normalized = normalizePatch(patch);
    return [...Object.keys(normalized.set), ...normalized.del, ...Object.keys(normalized.append), ...Object.keys(normalized.init || {})];
}
