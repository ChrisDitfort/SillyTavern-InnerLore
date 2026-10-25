/**
 * The picture job: a person in a text or mind-speech conversation sends a
 * picture, described in a few words in their reply. One short model call
 * reads who the picture shows (the sender, someone else the story knows, or
 * nobody) and the shot itself; the person in it is drawn from their look (the
 * identity tags and seed of their portrait, made now when they have none), so
 * the face in the photo is the face in the portrait. The picture is saved like
 * a portrait, owned by the chat, and committed into the store under
 * `pictures` by its id, where the open conversation finds it. A failure is
 * committed too, so the conversation shows it rather than waiting forever.
 */
import {
    PICTURE_DEFAULTS,
    buildPictureMessages,
    clothingFromDescription,
    composePicturePrompt,
    findLook,
    lookTags,
    outfitOf,
    parsePictureReply,
    pictureFileStem,
    pictureNegativeFor,
    portraitPayload,
} from '../../../portrait.js?v=9';
import { cleanString } from '../../../core.js?v=49';
import { personRecord, resolveLook } from './look.js';
import { drawnPicture } from './portrait.js?v=9';

export const PICTURE_ID = /^[a-z0-9][a-z0-9-]{3,79}$/u;

function knownPeople(snapshot) {
    return Object.values(snapshot?.entities || {})
        .filter(record => record?.type === 'character' && record.enabled !== false && !record.player)
        .sort((a, b) => (Number(b.lastSeenMessage) || 0) - (Number(a.lastSeenMessage) || 0))
        .slice(0, 30)
        .map(record => ({ name: record.name, aliases: Array.isArray(record.aliases) ? record.aliases : [] }));
}

export function createPictureJob({ llm, images, store, hub, log = () => {}, now = Date.now }) {
    return async function runPicture(job, tools) {
        const input = job.input || {};
        const id = String(input.id || '').trim().toLowerCase();
        const sender = cleanString(input.person, 160);
        const description = cleanString(input.description, 400);
        // A text's photo, an image shown mind to mind, or the player's own view of the person in a quiet word.
        const channel = ['mind', 'aside'].includes(input.channel) ? input.channel : 'text';
        if (!PICTURE_ID.test(id) || !sender || !description) throw new Error('the picture job needs an id, a sender and a description');
        const current = store.read(job.worldId);
        if (!current?.store) throw new Error('the world has no store yet');
        const snapshot = current.store;
        if (snapshot.pictures?.[id]?.path) return { skipped: 'exists', id };
        const base = { id, person: sender, channel, description };
        const settings = input.settings || {};
        try {
            tools.setDetail('choosing the shot');
            const people = knownPeople(snapshot);
            // What the sender usually wears, so the shot only dresses them differently when the picture calls for it.
            const senderEntity = personRecord(snapshot, sender);
            const senderLook = findLook(snapshot.portraits || {}, sender, [senderEntity?.name, ...(senderEntity?.aliases || [])].filter(Boolean));
            const text = await llm.request({
                connection: input.connection,
                fallback: input.fallback,
                messages: buildPictureMessages({
                    description,
                    channel,
                    sender,
                    senderLocation: cleanString(input.senderLocation, 160),
                    placeSummary: cleanString(input.placeSummary, 300),
                    people,
                    viewer: cleanString(input.names?.playerName, 120),
                    usualOutfit: senderLook ? outfitOf(lookTags(senderLook.record)) : '',
                    others: Array.isArray(input.others) ? input.others.map(name => cleanString(name, 120)).filter(Boolean) : null,
                }),
                maxTokens: 600,
                temperature: 0.4,
                names: input.names,
                directories: job.directories,
                signal: tools.signal,
                timeoutMs: Number(settings.requestTimeoutSeconds) > 0 ? Number(settings.requestTimeoutSeconds) * 1_000 : 90_000,
                kind: 'picture',
            });
            const shot = parsePictureReply(text, { sender, people, channel });
            // What the description says they wear, when the shot's model left it out ("dark green wool dress").
            if (shot.subject && channel !== 'aside') {
                const named = clothingFromDescription(description).filter(tag => !shot.tags.includes(tag));
                if (named.length) shot.tags.push(...named);
            }
            let identity = [];
            let seed;
            let made = null;
            if (shot.subject) {
                const look = await resolveLook({ llm, snapshot, name: shot.subject.name, input: { ...input, placeName: input.senderLocation }, job, tools });
                if (look) {
                    identity = look.tags;
                    seed = look.seed;
                    if (look.made) made = look;
                }
            }
            const payload = portraitPayload(composePicturePrompt({
                identity,
                scene: shot.tags,
                style: settings.portraitStyle || undefined,
                channel,
                mindStyle: settings.pictureMindStyle || undefined,
            }), {
                negative: pictureNegativeFor(identity, settings.portraitNegative || undefined),
                steps: settings.portraitSteps,
                cfg: settings.portraitCfg,
                seed,
                size: PICTURE_DEFAULTS.size,
            });

            tools.setDetail('drawing');
            const drawn = drawnPicture(await images.generate({ service: input.service || {}, payload, directories: job.directories }, { signal: tools.signal }), payload.seed);
            if (tools.signal.aborted) throw tools.signal.reason || new DOMException('Aborted', 'AbortError');
            if (!drawn.image) throw new Error('the image server sent no picture');
            const picture = await images.shrink(drawn.image, { side: PICTURE_DEFAULTS.size });
            const path = await images.savePortrait({
                directories: job.directories,
                fileName: `${pictureFileStem(job.chatId || snapshot.chatId || '', id)}-${drawn.seed}`,
                buffer: picture.buffer,
                format: picture.format,
            });
            const record = { ...base, subject: shot.subject?.name || '', path, seed: drawn.seed, at: now() };
            const committed = store.commit(job.worldId, job.chatId, latest => {
                latest.pictures = { ...(latest.pictures && typeof latest.pictures === 'object' ? latest.pictures : {}), [id]: record };
                if (made) {
                    // The look made for this picture is kept: the portrait drawn later, and every picture after, start from it.
                    const records = latest.portraits && typeof latest.portraits === 'object' ? latest.portraits : {};
                    const entity = made.entity;
                    if (!findLook(records, entity?.name || shot.subject.name, entity?.aliases || [])) {
                        latest.portraits = { ...records, [made.key]: { ...(records[made.key] || {}), name: entity?.name || shot.subject.name, tags: made.tags, seed: made.seed, at: now() } };
                    }
                }
                return latest;
            }, { reason: 'picture' });
            // The world was deleted while this was drawn: nothing keeps the file, so it goes too.
            if (committed?.missing) {
                await images.removePortrait?.({ directories: job.directories, path });
                return { skipped: 'deleted', path };
            }
            hub?.broadcast?.(job.worldId, { type: 'picture', id, path, revision: committed?.revision ?? null });
            log(`picture ${id} from ${sender} (${shot.subject ? `shows ${shot.subject.name}, seed ${drawn.seed}` : 'nobody in it'}) saved as ${path}`);
            return { ...record, revision: committed?.revision ?? null };
        } catch (error) {
            if (tools.signal?.aborted || error?.name === 'AbortError') throw error;
            try {
                store.commit(job.worldId, job.chatId, latest => {
                    if (latest.pictures?.[id]?.path) return null;
                    latest.pictures = { ...(latest.pictures && typeof latest.pictures === 'object' ? latest.pictures : {}), [id]: { ...base, failed: true, error: String(error?.message || error).slice(0, 300), at: now() } };
                    return latest;
                }, { reason: 'picture-failed' });
            } catch { /* the job's own failure is what counts */ }
            throw error;
        }
    };
}
