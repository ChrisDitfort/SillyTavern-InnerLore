/**
 * The portrait job: the person's look (their identity tags and seed, made
 * from what the story knows about them, or the one they already have) is
 * drawn by the image service on a plain backdrop, the picture is shrunk and
 * saved, and the record is committed into the store under `portraits`, where
 * the page finds it by name or alias. A new portrait the player asks for gets
 * a fresh look; every other drawing of the person reuses theirs.
 */
import {
    composePortraitPrompt,
    findPortrait,
    portraitFileStem,
    portraitNegativeFor,
    portraitPayload,
} from '../../../portrait.js?v=9';
import { canonicalNameKey } from '../../../core.js?v=49';
import { personRecord, resolveLook } from './look.js';

/** An image service's answer as `{ image, seed }` (a bare base64 string from older services). */
export function drawnPicture(result, askedSeed) {
    if (typeof result === 'string') return { image: result, seed: askedSeed };
    return { image: result?.image, seed: Number.isInteger(result?.seed) ? result.seed : askedSeed };
}

export function createPortraitJob({ llm, images, store, hub, log = () => {}, now = Date.now }) {
    return async function runPortrait(job, tools) {
        const input = job.input || {};
        const name = String(input.name || '').trim();
        if (!name || !canonicalNameKey(name)) throw new Error('the portrait job names nobody');
        const current = store.read(job.worldId);
        if (!current?.store) throw new Error('the world has no store yet');
        const snapshot = current.store;
        const entity = personRecord(snapshot, name);
        const aliases = [entity?.name, ...(entity?.aliases || [])].filter(Boolean);
        if (!input.force && findPortrait(snapshot.portraits || {}, name, aliases)) return { skipped: 'exists' };

        tools.setDetail('choosing the look');
        const look = await resolveLook({ llm, snapshot, name, input, job, tools, fresh: input.newLook === true });
        if (!look) throw new Error('the story has not described them yet');
        const settings = input.settings || {};
        const payload = portraitPayload(composePortraitPrompt(look.tags, settings.portraitStyle || undefined, { background: settings.portraitBackground ?? undefined }), {
            negative: portraitNegativeFor(look.tags, settings.portraitNegative || undefined),
            steps: settings.portraitSteps,
            cfg: settings.portraitCfg,
            seed: look.seed,
        });

        tools.setDetail('drawing');
        const drawn = drawnPicture(await images.generate({ service: input.service || {}, payload, directories: job.directories }, { signal: tools.signal }), payload.seed);
        if (tools.signal.aborted) throw tools.signal.reason || new DOMException('Aborted', 'AbortError');
        if (!drawn.image) throw new Error('the image server sent no picture');
        const picture = await images.shrink(drawn.image);
        const path = await images.savePortrait({
            directories: job.directories,
            fileName: `${portraitFileStem(job.chatId || snapshot.chatId || '', look.key)}-${drawn.seed}`,
            buffer: picture.buffer,
            format: picture.format,
        });
        const record = { name: entity?.name || name, path, tags: look.tags, seed: drawn.seed, at: now() };
        const committed = store.commit(job.worldId, job.chatId, latest => {
            latest.portraits = { ...(latest.portraits && typeof latest.portraits === 'object' ? latest.portraits : {}), [look.key]: record };
            return latest;
        }, { reason: 'portrait' });
        // The world was deleted while this was drawn: nothing keeps the file, so it goes too.
        if (committed?.missing) {
            await images.removePortrait?.({ directories: job.directories, path });
            return { skipped: 'deleted', path };
        }
        hub?.broadcast?.(job.worldId, { type: 'portrait', key: look.key, name: record.name, path, revision: committed?.revision ?? null });
        log(`portrait of ${record.name} saved as ${path} (seed ${drawn.seed}${look.made ? ', new look' : ', kept look'})`);
        return { key: look.key, ...record, revision: committed?.revision ?? null };
    };
}
