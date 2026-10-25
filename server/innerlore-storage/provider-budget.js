/**
 * How much of each provider the server may use at once, and the story's
 * share of it.
 *
 * Providers that limit one account's simultaneous requests refuse the rest
 * with 429: NovelAI serves one generation at a time, Featherless has four
 * concurrency units (a model costs 1, 2 or 4 by its size), the NanoGPT
 * subscription ten requests. Every background request the server sends
 * takes a turn here first; the wait is not part of the request's timeout.
 *
 * The story itself is sent by the browser, not the server, so the browser
 * tells the server when a story request is out (a claim, renewed while it
 * streams, expiring on its own). While a claim is fresh its cost is kept
 * free on that provider, and the job runner holds new passes for the world
 * so none reads a half-written reply.
 */
export const LIMITED_PROVIDERS = Object.freeze({ 'novelai.net': 1, 'featherless.ai': 4, 'nano-gpt.com': 10 });
export const STORY_CLAIM_TTL_MS = 120_000;

export function limitedHost(url) {
    let host = '';
    try {
        host = new URL(String(url || '')).hostname;
    } catch {
        return '';
    }
    return Object.keys(LIMITED_PROVIDERS).find(item => host === item || host.endsWith(`.${item}`)) || '';
}

/** A model's size in billions of parameters from its name ("Gemma-4-31B" is 31); Infinity when unnamed. */
export function modelSizeBillions(model) {
    const sizes = [...String(model || '').matchAll(/(\d+(?:\.\d+)?)\s*[bB](?![a-z])/gu)].map(match => Number(match[1]));
    return sizes.length ? Math.max(...sizes) : Infinity;
}

export function providerCost(provider, model) {
    if (provider !== 'featherless.ai') return provider ? 1 : 0;
    const size = modelSizeBillions(model);
    return size < 16 ? 1 : size < 35 ? 2 : 4;
}

/** The provider a connection record reaches, if it is a limited one; '' otherwise. */
export function providerOf(connection) {
    if (!connection) return '';
    if (connection.mode === 'novel') return 'novelai.net';
    return limitedHost(connection.url);
}

export function createBudget({ now = Date.now, ttlMs = STORY_CLAIM_TTL_MS, onChange = () => {} } = {}) {
    const units = new Map();
    const claims = new Map();
    const listeners = new Set();

    const unitsOf = provider => {
        if (!units.has(provider)) units.set(provider, { used: 0, waiting: [] });
        return units.get(provider);
    };
    const sweep = () => {
        for (const [worldId, claim] of claims) {
            if (now() - claim.at > ttlMs) claims.delete(worldId);
        }
    };
    const reserved = provider => {
        sweep();
        let total = 0;
        for (const claim of claims.values()) if (claim.provider === provider) total += claim.cost;
        return total;
    };
    const pump = provider => {
        const entry = units.get(provider);
        if (!entry) return;
        for (let index = 0; index < entry.waiting.length; index++) {
            if (entry.waiting[index]()) entry.waiting.splice(index--, 1);
        }
    };
    const changed = provider => {
        const detail = snapshot(provider);
        onChange(detail);
        for (const listener of listeners) {
            try { listener(detail); } catch { /* a listener's failure is its own */ }
        }
    };
    function snapshot(provider) {
        const entry = units.get(provider);
        return {
            provider,
            limit: LIMITED_PROVIDERS[provider] ?? null,
            used: entry?.used || 0,
            waiting: entry?.waiting.length || 0,
            reserved: provider ? reserved(provider) : 0,
        };
    }

    return {
        LIMITED_PROVIDERS,
        /** Whether `cost` more units fit on the provider now, beside the story's reserve. */
        hasRoom(provider, cost = 1, { ignoreReserve = false } = {}) {
            if (!provider || !LIMITED_PROVIDERS[provider]) return true;
            const held = ignoreReserve ? 0 : reserved(provider);
            const free = LIMITED_PROVIDERS[provider] - held;
            // While the story holds its share, background work fits only in
            // what is left (on NovelAI, nothing: it waits for the claim to
            // end). With nothing reserved, a request larger than the whole
            // budget (a 70B Featherless model, 4 units) still goes when idle.
            return (units.get(provider)?.used || 0) + cost <= (held > 0 ? free : Math.max(cost, free));
        },
        /** Waits for `cost` units and resolves to the function that returns them. */
        async take(provider, cost = 1, { signal } = {}) {
            if (!provider || !LIMITED_PROVIDERS[provider]) return () => {};
            const entry = unitsOf(provider);
            await new Promise((resolve, reject) => {
                const attempt = () => {
                    if (signal?.aborted) { reject(signal.reason || new DOMException('Aborted', 'AbortError')); return true; }
                    if (!this.hasRoom(provider, cost)) return false;
                    entry.used += cost;
                    resolve();
                    return true;
                };
                if (attempt()) return;
                entry.waiting.push(attempt);
                signal?.addEventListener?.('abort', () => {
                    const index = entry.waiting.indexOf(attempt);
                    if (index >= 0) entry.waiting.splice(index, 1);
                    reject(signal.reason || new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            });
            changed(provider);
            let returned = false;
            return () => {
                if (returned) return;
                returned = true;
                entry.used = Math.max(0, entry.used - cost);
                pump(provider);
                changed(provider);
            };
        },
        inUse(provider) {
            const entry = provider ? units.get(provider) : null;
            return Boolean(entry && (entry.used > 0 || entry.waiting.length));
        },
        /** The browser's story request on this world: fresh for ttlMs unless renewed or ended. */
        claimStory(worldId, { provider = '', cost = 1, quiet = false } = {}) {
            claims.set(worldId, { provider, cost: Math.max(0, Number(cost) || 0), quiet: Boolean(quiet), at: now() });
            if (provider) changed(provider);
        },
        releaseStory(worldId) {
            const claim = claims.get(worldId);
            claims.delete(worldId);
            if (claim?.provider) {
                pump(claim.provider);
                changed(claim.provider);
            }
        },
        storyClaim(worldId) {
            sweep();
            return claims.get(worldId) || null;
        },
        storyFresh(worldId) {
            sweep();
            return claims.has(worldId);
        },
        snapshot,
        snapshots() {
            return [...new Set([...units.keys(), ...[...claims.values()].map(claim => claim.provider)])].filter(Boolean).map(snapshot);
        },
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
