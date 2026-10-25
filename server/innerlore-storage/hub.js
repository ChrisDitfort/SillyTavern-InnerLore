/**
 * The WebSocket the page keeps open to the plugin: the server pushes job
 * progress, new store revisions and finished portraits; the page subscribes
 * to its world and reports its story requests. SillyTavern hands a plugin
 * only a router, so the HTTP server is picked up from the first request's
 * socket and the upgrade handler attached then; the page makes a plain
 * request before it opens the socket. Upgrades bypass SillyTavern's
 * whitelist, session and CSRF checks, so the hub admits loopback peers whose
 * Origin names this host and nothing else.
 */
export const WS_PATH = '/api/plugins/innerlore-storage/v1/ws';
const HEARTBEAT_MS = 30_000;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createHub({ ws, log = () => {}, onMessage = () => {}, onSubscribe = () => null } = {}) {
    const WebSocketServer = ws?.WebSocketServer || ws?.Server || null;
    const sockets = new Set();
    let server = null;
    let wss = null;
    let heartbeat = null;

    const safeSend = (socket, message) => {
        try {
            if (socket.readyState === 1) socket.send(JSON.stringify(message));
        } catch (error) {
            log(`send failed: ${error?.message || error}`);
        }
    };

    function admit(request) {
        const address = String(request.socket?.remoteAddress || '');
        if (!LOOPBACK.has(address)) return false;
        const origin = String(request.headers.origin || '');
        const host = String(request.headers.host || '');
        if (!origin) return true;
        try {
            return new URL(origin).host === host;
        } catch {
            return false;
        }
    }

    function handleUpgrade(request, socket, head) {
        let pathname = '';
        try {
            pathname = new URL(request.url, 'http://localhost').pathname;
        } catch {
            pathname = '';
        }
        if (pathname !== WS_PATH) {
            // Nothing else in SillyTavern speaks WebSocket; an upgrade for any
            // other path is answered the way an unhandled one would be.
            if (server.listenerCount('upgrade') <= 1) socket.destroy();
            return;
        }
        if (!admit(request)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }
        try {
            wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request));
        } catch (error) {
            log(`upgrade failed: ${error?.message || error}`);
            try { socket.destroy(); } catch { /* already gone */ }
        }
    }

    /** A short name for the browser behind a socket, for the log ("SamsungBrowser 27", "HeadlessChrome"). */
    function agentOf(request) {
        const agent = String(request?.headers?.['user-agent'] || '');
        const match = /(SamsungBrowser|HeadlessChrome|Firefox|Edg|OPR|Chrome|Safari)\/(\d+)/u.exec(agent);
        return match ? `${match[1]} ${match[2]}` : (agent.slice(0, 40) || 'unknown');
    }

    function onConnection(socket, request) {
        socket.innerlore = { worlds: new Set(), alive: true, agent: agentOf(request), since: Date.now() };
        sockets.add(socket);
        log(`page connected (${socket.innerlore.agent}); ${sockets.size} open`);
        socket.on('pong', () => { socket.innerlore.alive = true; });
        socket.on('error', error => log(`socket error: ${error?.message || error}`));
        socket.on('close', () => {
            sockets.delete(socket);
            log(`page disconnected (${socket.innerlore.agent}); ${sockets.size} open`);
        });
        socket.on('message', data => {
            let message;
            try {
                message = JSON.parse(String(data));
            } catch {
                return;
            }
            if (!message || typeof message !== 'object') return;
            try {
                if (message.type === 'ping') {
                    safeSend(socket, { type: 'pong', at: Date.now() });
                } else if (message.type === 'subscribe') {
                    const worldId = String(message.worldId || '');
                    if (!worldId) return;
                    if (message.exclusive !== false) socket.innerlore.worlds.clear();
                    socket.innerlore.worlds.add(worldId);
                    if (message.clientId) socket.innerlore.clientId = String(message.clientId).slice(0, 80);
                    const state = onSubscribe({ worldId, chatId: String(message.chatId || ''), revision: Number(message.revision) || 0 }, socket);
                    if (state) safeSend(socket, { type: 'state', worldId, ...state });
                } else if (message.type === 'unsubscribe') {
                    socket.innerlore.worlds.delete(String(message.worldId || ''));
                } else {
                    onMessage(message, socket);
                }
            } catch (error) {
                log(`message handler failed: ${error?.message || error}`);
            }
        });
        safeSend(socket, { type: 'hello', at: Date.now() });
    }

    return {
        get enabled() { return Boolean(WebSocketServer); },
        get attached() { return Boolean(server); },
        get connections() { return sockets.size; },
        /** Who is connected and to which worlds, for the health route. */
        describe() {
            return {
                enabled: Boolean(WebSocketServer),
                attached: Boolean(server),
                connections: [...sockets].map(socket => ({
                    agent: socket.innerlore?.agent || '',
                    worlds: [...(socket.innerlore?.worlds || [])],
                    seconds: Math.round((Date.now() - (socket.innerlore?.since || Date.now())) / 1000),
                })),
            };
        },
        /** Called with every plugin request: the first one gives us the server. */
        ensureAttached(request) {
            if (server || !WebSocketServer) return;
            const candidate = request?.socket?.server;
            if (!candidate || typeof candidate.on !== 'function') return;
            server = candidate;
            wss = new WebSocketServer({ noServer: true });
            wss.on('connection', onConnection);
            wss.on('error', error => log(`server error: ${error?.message || error}`));
            server.on('upgrade', handleUpgrade);
            heartbeat = setInterval(() => {
                for (const socket of sockets) {
                    if (!socket.innerlore.alive) { try { socket.terminate(); } catch { /* gone */ } continue; }
                    socket.innerlore.alive = false;
                    try { socket.ping(); } catch { /* gone */ }
                }
            }, HEARTBEAT_MS);
            heartbeat.unref?.();
            log('WebSocket hub attached');
        },
        /** Sends to every socket subscribed to the world (optionally except one). */
        broadcast(worldId, message, { except = null, exceptWriter = '' } = {}) {
            for (const socket of sockets) {
                if (socket === except || !socket.innerlore.worlds.has(worldId)) continue;
                if (exceptWriter && socket.innerlore.clientId === exceptWriter) continue;
                safeSend(socket, { worldId, ...message });
            }
        },
        broadcastAll(message) {
            for (const socket of sockets) safeSend(socket, message);
        },
        send: safeSend,
        close() {
            clearInterval(heartbeat);
            for (const socket of sockets) { try { socket.close(); } catch { /* gone */ } }
            sockets.clear();
            if (server) server.off('upgrade', handleUpgrade);
            server = null;
            wss = null;
        },
    };
}
