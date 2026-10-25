/**
 * The page's end of the plugin's WebSocket: one socket, re-opened with a
 * growing delay when it drops, re-subscribed whenever the page comes back
 * (visible again, restored from the back-forward cache, back online), so a
 * phone browser that froze the tab learns on waking what finished while it
 * slept. The server answers every subscribe with the world's state, which is
 * the resync; the socket is only the fast path.
 *
 * Pure enough for Node: it takes the WebSocket constructor and fetch as
 * options, and does nothing without a document.
 */
const WS_SUFFIX = '/ws';
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const PING_MS = 25_000;

export function createServerEvents({
    apiRoot,
    getHeaders = () => ({}),
    clientId = '',
    WebSocketImpl = globalThis.WebSocket,
    fetchImpl = globalThis.fetch,
    onMessage = () => {},
    onStatus = () => {},
    log = () => {},
    documentRef = globalThis.document,
    windowRef = globalThis.window,
} = {}) {
    let socket = null;
    let retryMs = MIN_RETRY_MS;
    let retryTimer = null;
    let pingTimer = null;
    let subscription = null;
    let wanted = false;
    let status = 'closed';

    const setStatus = next => {
        if (status === next) return;
        status = next;
        try { onStatus(status); } catch { /* a listener's failure is its own */ }
    };

    function url() {
        const base = typeof windowRef?.location?.origin === 'string' ? windowRef.location.origin : 'http://127.0.0.1:8000';
        return `${base.replace(/^http/u, 'ws')}${apiRoot}${WS_SUFFIX}`;
    }

    function send(message) {
        if (!socket || socket.readyState !== 1) return false;
        try {
            socket.send(JSON.stringify(message));
            return true;
        } catch (error) {
            log('send failed', error);
            return false;
        }
    }

    function sendSubscription() {
        if (!subscription) return;
        send({ type: 'subscribe', worldId: subscription.worldId, chatId: subscription.chatId, revision: subscription.revision(), clientId });
    }

    async function open() {
        if (!wanted || socket || typeof WebSocketImpl !== 'function') return;
        clearTimeout(retryTimer);
        retryTimer = null;
        setStatus('connecting');
        try {
            // A plain request first: the plugin attaches its upgrade handler to
            // the server it sees on the first request.
            await fetchImpl(`${apiRoot}/health`, { headers: getHeaders() }).catch(() => null);
            if (!wanted || socket) return;
            const candidate = new WebSocketImpl(url());
            socket = candidate;
            candidate.onopen = () => {
                if (socket !== candidate) return;
                retryMs = MIN_RETRY_MS;
                setStatus('open');
                sendSubscription();
                clearInterval(pingTimer);
                pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
                pingTimer.unref?.();
            };
            candidate.onmessage = event => {
                if (socket !== candidate) return;
                let message;
                try { message = JSON.parse(String(event.data)); } catch { return; }
                if (!message || typeof message !== 'object' || message.type === 'pong' || message.type === 'hello') return;
                try { onMessage(message); } catch (error) { log('message handler failed', error); }
            };
            candidate.onerror = () => { /* close follows */ };
            candidate.onclose = () => {
                if (socket === candidate) socket = null;
                clearInterval(pingTimer);
                pingTimer = null;
                setStatus('closed');
                scheduleRetry();
            };
        } catch (error) {
            log('open failed', error);
            socket = null;
            setStatus('closed');
            scheduleRetry();
        }
    }

    function scheduleRetry() {
        if (!wanted || retryTimer) return;
        retryTimer = setTimeout(() => { retryTimer = null; void open(); }, retryMs);
        retryTimer.unref?.();
        retryMs = Math.min(MAX_RETRY_MS, retryMs * 2);
    }

    function wake() {
        if (!wanted) return;
        if (socket?.readyState === 1) sendSubscription();
        else {
            // The old socket may be dead without a close event after a freeze.
            if (socket && socket.readyState !== 0) { try { socket.close(); } catch { /* gone */ } socket = null; }
            retryMs = MIN_RETRY_MS;
            void open();
        }
    }

    if (documentRef?.addEventListener) {
        documentRef.addEventListener('visibilitychange', () => { if (documentRef.visibilityState === 'visible') wake(); });
    }
    if (windowRef?.addEventListener) {
        windowRef.addEventListener('pageshow', wake);
        windowRef.addEventListener('online', wake);
        windowRef.addEventListener('focus', wake);
    }

    return {
        /** Follows a world; the server answers with its state at once and on every reconnect. */
        subscribe(worldId, chatId, revision) {
            subscription = { worldId, chatId, revision: typeof revision === 'function' ? revision : () => Number(revision) || 0 };
            wanted = true;
            if (socket?.readyState === 1) sendSubscription();
            else void open();
        },
        unsubscribe() {
            if (subscription && socket?.readyState === 1) send({ type: 'unsubscribe', worldId: subscription.worldId });
            subscription = null;
        },
        /** Tells the server about the story request (start, renew, end). */
        story(message) {
            return send({ type: 'story', ...message });
        },
        wake,
        send,
        get status() { return status; },
        get connected() { return socket?.readyState === 1; },
        close() {
            wanted = false;
            subscription = null;
            clearTimeout(retryTimer);
            clearInterval(pingTimer);
            try { socket?.close(); } catch { /* gone */ }
            socket = null;
            setStatus('closed');
        },
    };
}
