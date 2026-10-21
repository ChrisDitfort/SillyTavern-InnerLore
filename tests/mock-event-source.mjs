/**
 * SillyTavern's event source, as InnerLore sees it: an event can have several
 * listeners, and emitting it runs every one in the order they were added,
 * awaiting each (public/lib/eventemitter.js). `get(event)` returns that emit.
 * SillyTavern logs a listener's error and carries on; here the first error is
 * rethrown once every listener has run, so a crash still fails the test.
 */
export function createEventListeners() {
    const byEvent = new Map();
    return {
        on(event, callback) {
            if (!byEvent.has(event)) byEvent.set(event, []);
            byEvent.get(event).push(callback);
        },
        has: event => byEvent.has(event),
        get(event) {
            const callbacks = byEvent.get(event);
            if (!callbacks) return undefined;
            return async (...args) => {
                let failure = null;
                for (const callback of callbacks.slice()) {
                    try {
                        await callback(...args);
                    } catch (error) {
                        failure ??= error;
                    }
                }
                if (failure) throw failure;
            };
        },
        get size() {
            return byEvent.size;
        },
    };
}
