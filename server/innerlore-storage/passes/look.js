/**
 * A person's look on the server: the identity tags and the seed that every
 * picture of them starts from, kept on their portrait record. It is made once
 * (one short model call on the game role's connection) and then reused: by
 * their portrait, and by every picture they appear in, so the same face comes
 * back each time.
 */
import { buildPortraitMessages, findLook, lookTags, newPortraitSeed, parsePortraitTags, portraitSource, withChestTag } from '../../../portrait.js?v=9';
import { canonicalNameKey } from '../../../core.js?v=49';

/** The story's record of someone, found by name or alias. */
export function personRecord(snapshot, name) {
    const key = canonicalNameKey(name);
    if (!key) return null;
    return Object.values(snapshot?.entities || {}).find(record => record?.type === 'character'
        && (canonicalNameKey(record.name) === key || (record.aliases || []).some(alias => canonicalNameKey(alias) === key))) || null;
}

/**
 * Someone's look: `{ key, tags, seed, entity, made }`. An existing look is
 * reused unless `fresh` (a new portrait the player asked for); otherwise the
 * story's description becomes tags and a new seed is drawn. Null when the
 * story has not described them yet.
 */
export async function resolveLook({ llm, snapshot, name, input = {}, job = {}, tools = {}, fresh = false }) {
    const entity = personRecord(snapshot, name);
    const aliases = [entity?.name, ...(entity?.aliases || [])].filter(Boolean);
    const existing = findLook(snapshot?.portraits || {}, name, aliases);
    if (existing && !fresh) {
        return { key: existing.key, tags: withChestTag(lookTags(existing.record)), seed: existing.record.seed, entity, made: false };
    }
    const source = portraitSource(snapshot, entity?.name || name, { placeName: String(input.placeName || '') });
    if (!source) return null;
    const text = await llm.request({
        connection: input.connection,
        fallback: input.fallback,
        messages: buildPortraitMessages(source),
        maxTokens: 800,
        temperature: 0.4,
        names: input.names,
        directories: job.directories,
        signal: tools.signal,
        timeoutMs: Number(input.settings?.requestTimeoutSeconds) > 0 ? Number(input.settings.requestTimeoutSeconds) * 1_000 : 90_000,
        kind: 'portrait',
    });
    const tags = parsePortraitTags(text, entity?.name || name);
    if (tags.length < 3) throw new Error(`the portrait tags were unusable: ${String(text).slice(0, 200)}`);
    // A look is kept under the name the story uses, so a lost alias never loses it.
    const key = existing?.key || canonicalNameKey(entity?.name || name);
    return { key, tags: withChestTag(tags), seed: newPortraitSeed(), entity, made: true };
}
