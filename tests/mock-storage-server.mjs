function response(status, payload) {
    return {
        status,
        ok: status >= 200 && status < 300,
        async json() { return structuredClone(payload); },
    };
}

const success = (data, status = 200) => response(status, { ok: true, data });
const failure = (status, code, message, details) => response(status, {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
});

export function installMockInnerLoreStorage() {
    const worlds = new Map();
    const deletedWorldIds = new Set();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input, options = {}) => {
        const url = new URL(String(input), 'http://innerlore.test');
        const prefix = '/api/plugins/airpg-storage/v1';
        if (!url.pathname.startsWith(prefix)) {
            if (typeof originalFetch === 'function') return originalFetch(input, options);
            throw new Error(`Unexpected fetch: ${url.pathname}`);
        }
        const route = url.pathname.slice(prefix.length);
        const method = String(options.method || 'GET').toUpperCase();
        const body = options.body ? JSON.parse(options.body) : {};

        if (route === '/health' && method === 'GET') {
            return success({ status: 'ok', plugin: 'airpg-storage', openWorlds: worlds.size });
        }
        if (route === '/worlds' && method === 'POST') {
            if (worlds.has(body.id)) return failure(409, 'CONFLICT', 'World already exists');
            const world = {
                world_id: body.id,
                name: body.name || body.id,
                metadata: structuredClone(body.metadata || {}),
                innerLore: null,
                contextProfiles: new Map(),
            };
            worlds.set(body.id, world);
            return success(structuredClone(world), 201);
        }

        const match = route.match(/^\/worlds\/([^/]+)(.*)$/u);
        if (!match) return failure(404, 'NOT_FOUND', 'Route not found');
        const worldId = decodeURIComponent(match[1]);
        const suffix = match[2];
        const world = worlds.get(worldId);
        if (suffix === '' && method === 'GET') {
            if (!world) return failure(404, 'NOT_FOUND', 'World not found');
            return success({ world_id: worldId, name: world.name, metadata: structuredClone(world.metadata) });
        }
        if (!world) return failure(404, 'NOT_FOUND', 'World not found');

        if (suffix === '/innerlore/store' && method === 'GET') {
            if (!world.innerLore) return failure(404, 'NOT_FOUND', 'InnerLore store not found');
            return success(structuredClone(world.innerLore));
        }
        if (suffix === '/innerlore/store' && method === 'PUT') {
            const actualRevision = world.innerLore?.revision || 0;
            if (body.expectedRevision !== undefined && body.expectedRevision !== actualRevision) {
                return failure(409, 'CONFLICT', 'InnerLore store revision changed', {
                    expectedRevision: body.expectedRevision,
                    actualRevision,
                });
            }
            const revision = actualRevision + 1;
            world.innerLore = {
                worldId,
                chatId: body.chatId,
                storeVersion: body.store.version || 0,
                expressionFoundationVersion: body.store.expressionFoundationVersion || 0,
                revision,
                snapshotHash: `mock-${revision}`,
                migrationSource: body.migrationSource || world.innerLore?.migrationSource || null,
                createdAt: world.innerLore?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                store: structuredClone(body.store),
                counts: {},
                graphRootId: 'innerlore:store',
                changed: true,
                projection: { ok: true, processed: 0, pending: 0 },
                branch: structuredClone(body.branch || world.innerLore?.branch || { id: 'main' }),
                scene: structuredClone(body.scene || world.innerLore?.scene || {}),
            };
            return success(structuredClone(world.innerLore), revision === 1 ? 201 : 200);
        }
        if (suffix === '/innerlore/context/build' && method === 'POST') {
            if (!world.innerLore) return failure(404, 'NOT_FOUND', 'InnerLore store not found');
            if (body.expectedRevision !== undefined && body.expectedRevision !== world.innerLore.revision) {
                return failure(409, 'CONFLICT', 'InnerLore context requested from a stale store revision');
            }
            const store = world.innerLore.store;
            const scene = body.scene && Object.keys(body.scene).length ? body.scene : world.innerLore.scene;
            const mindLines = Object.values(store.brains || {}).flatMap(brain => {
                const current = brain.currentMind || {};
                return [current.perception, current.interpretation, current.intention]
                    .filter(Boolean).map(text => `${brain.name}: ${text}`);
            });
            const loreLines = Object.values(store.entities || {}).filter(entity => entity.enabled !== false)
                .map(entity => `${entity.name}: ${entity.summary || entity.currentState || ''}`);
            const progressionLines = [
                ...Object.values(store.progression?.goals || {}),
                ...Object.values(store.progression?.processes || {}),
                ...Object.values(store.progression?.events || {}),
            ].map(item => `${item.title || item.name || item.id}: ${item.status || ''}`);
            const sections = {
                scene: Object.keys(scene || {}).length ? `<innerlore_scene>\n- ${JSON.stringify(scene)}\n</innerlore_scene>` : '',
                minds: body.audience?.role === 'public' || !mindLines.length ? '' : `<innerlore_minds>\n- ${mindLines.join('\n- ')}\n</innerlore_minds>`,
                lore: loreLines.length ? `<innerlore_lore>\n- ${loreLines.join('\n- ')}\n</innerlore_lore>` : '',
                progression: progressionLines.length ? `<innerlore_progression>\n- ${progressionLines.join('\n- ')}\n</innerlore_progression>` : '',
            };
            const rendered = `<innerlore_state_context schema="innerlore.narrative-state.v1" store_revision="${world.innerLore.revision}" branch="${body.branchId || 'main'}">\n${Object.values(sections).filter(Boolean).join('\n')}\n</innerlore_state_context>`;
            const state = {
                schema: 'innerlore.narrative-state.v1',
                snapshot: { worldId, storeRevision: world.innerLore.revision, branchId: body.branchId || 'main', requestedHeadFingerprint: body.headFingerprint || null },
                scene, minds: mindLines, entities: loreLines, progression: progressionLines,
            };
            return success({ state, rendered, compact: rendered, sections, json: JSON.stringify(state),
                revision: world.innerLore.revision, diagnostics: { candidateCount: mindLines.length + loreLines.length + progressionLines.length },
                cache: { status: 'miss' } });
        }
        if (suffix === '/innerlore/event-director/context' && method === 'POST') {
            if (!world.innerLore) return failure(404, 'NOT_FOUND', 'InnerLore store not found');
            if (body.expectedRevision !== undefined && body.expectedRevision !== world.innerLore.revision) {
                return failure(409, 'CONFLICT', 'InnerLore Event Director requested from a stale store revision');
            }
            const store = world.innerLore.store;
            const lore = Object.values(store.entities || {}).map(entity => ({
                id: `lore:${entity.id}`, recordId: entity.id, kind: 'lore', name: entity.name,
                summary: entity.summary || '', unresolved: entity.unresolved || [],
                revision: entity.revision || 0, messageIndex: entity.lastSeenMessage || -1,
                graphNodeId: `mock:entity:${entity.id}`, generated: false,
            }));
            const motives = body.includePrivateMinds
                ? Object.values(store.brains || {}).map(brain => ({
                    id: `npc_motive:${brain.id}`, recordId: brain.id, kind: 'npc_motive', name: brain.name,
                    statement: brain.currentMind?.intention || '', graphNodeId: `mock:brain:${brain.id}`,
                    generated: false, private: true,
                }))
                : [];
            return success({
                schema: 'innerlore.event-director-context.v1',
                snapshot: { worldId, chatId: world.innerLore.chatId, storeRevision: world.innerLore.revision },
                branch: { id: body.branchId || 'main', headFingerprint: body.headFingerprint || '', scene: world.innerLore.scene || {} },
                sources: [...lore, ...motives],
                availableSourceIds: [...lore, ...motives].map(source => source.id),
                existingDefinitions: Object.values(store.progression?.eventDefinitions || {}),
                recentProposals: Object.values(store.progression?.eventProposals || {}),
                relations: [], diagnostics: { sqliteAuthoritative: true, relationCount: 0 },
            });
        }
        if (suffix === '/innerlore/context/profiles' && method === 'GET') {
            return success([
                { id: 'compact', name: 'Compact', builtin: true },
                { id: 'balanced', name: 'Balanced', builtin: true },
                { id: 'expansive', name: 'Expansive', builtin: true },
                ...[...world.contextProfiles.values()].map(structuredClone),
            ]);
        }
        const profileMatch = suffix.match(/^\/innerlore\/context\/profiles\/([^/]+)$/u);
        if (profileMatch && method === 'PUT') {
            const id = decodeURIComponent(profileMatch[1]);
            const previous = world.contextProfiles.get(id);
            const profile = { id, name: body.name || id, config: structuredClone(body.config || {}),
                revision: (previous?.revision || 0) + 1, builtin: false };
            world.contextProfiles.set(id, profile);
            return success(structuredClone(profile));
        }
        if (suffix === '/innerlore/fork' && method === 'POST') {
            if (!world.innerLore) return failure(404, 'NOT_FOUND', 'InnerLore store not found');
            if (worlds.has(body.targetWorldId)) return failure(409, 'CONFLICT', 'World already exists');
            const store = structuredClone(world.innerLore.store);
            store.chatId = body.targetChatId;
            store.lorebookName = '';
            for (const entity of Object.values(store.entities || {})) {
                entity.entryUid = null;
                entity.renderedHash = '';
            }
            store.processedFingerprints = {};
            if (store.progression) {
                store.progression.processedFingerprints = {};
                store.progression.eventProposals = {};
                store.progression.eventDirector = {};
                for (const [id, definition] of Object.entries(store.progression.eventDefinitions || {})) {
                    if (definition?.origin !== 'automatic_director') continue;
                    delete store.progression.eventDefinitions[id];
                    delete store.progression.eventRuntime?.[id];
                }
            }
            const target = {
                world_id: body.targetWorldId,
                name: `InnerLore: ${body.targetChatId}`,
                metadata: { kind: 'innerlore', chatId: body.targetChatId, forkedFrom: worldId },
                contextProfiles: new Map(),
                innerLore: {
                    ...world.innerLore,
                    worldId: body.targetWorldId,
                    chatId: body.targetChatId,
                    revision: 1,
                    snapshotHash: 'mock-1',
                    store,
                },
            };
            worlds.set(body.targetWorldId, target);
            return success(structuredClone(target.innerLore), 201);
        }
        if (suffix === '/innerlore/rename' && method === 'POST') {
            if (!world.innerLore) return failure(404, 'NOT_FOUND', 'InnerLore store not found');
            if (body.expectedRevision !== undefined && body.expectedRevision !== world.innerLore.revision) {
                return failure(409, 'CONFLICT', 'InnerLore store revision changed');
            }
            world.innerLore.store.chatId = body.chatId;
            world.innerLore.chatId = body.chatId;
            world.innerLore.revision += 1;
            world.innerLore.snapshotHash = `mock-${world.innerLore.revision}`;
            world.innerLore.updatedAt = new Date().toISOString();
            return success(structuredClone(world.innerLore));
        }
        if (suffix === '/innerlore/store' && method === 'DELETE') {
            deletedWorldIds.add(worldId);
            worlds.delete(worldId);
            return success({ worldId, chatId: world.innerLore?.chatId, deleted: true, recoverable: false });
        }
        return failure(404, 'NOT_FOUND', 'Route not found');
    };

    return {
        worlds,
        deletedWorldIds,
        restore() { globalThis.fetch = originalFetch; },
    };
}
