/**
 * Pictures on the server: a portrait drawn by the configured image service
 * (Local Dream through LDBridge or any A1111-compatible server; or an
 * OpenAI-compatible images API with the key from the secret store), shrunk
 * to a small square WebP with SillyTavern's own Jimp, and written under the
 * user's images folder where the page can show it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readSecretFromFile } from './st-bridge.js';

export const PORTRAIT_FOLDER = 'InnerLore';
const PORTRAIT_SIDE = 384;

function basicAuth(auth) {
    const value = String(auth || '').trim();
    return value ? { Authorization: `Basic ${Buffer.from(value).toString('base64')}` } : {};
}

/** The seed in an image server's answer (A1111's `info` is a JSON string), else the one asked for. */
function seedOf(info, asked) {
    let parsed = info;
    if (typeof info === 'string') {
        try { parsed = JSON.parse(info); } catch { parsed = null; }
    }
    const seed = Number(typeof parsed === 'object' && parsed !== null ? parsed.seed : parsed);
    return Number.isInteger(seed) && seed >= 0 ? seed : asked;
}

function sanitizeFileName(name) {
    return String(name || '').replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 180) || 'portrait';
}

export function createImages({ helpers, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
    const getHelpers = typeof helpers === 'function' ? helpers : async () => (helpers || {});

    return {
        /**
         * A picture from the image service for an A1111 txt2img payload, as
         * `{ image: base64, seed }`: the seed the server says it used (A1111's
         * `info`), else the one asked for, so a person's later pictures can be
         * drawn from the same one.
         */
        async generate({ service = {}, payload, directories }, { signal, timeoutMs = 300_000 } = {}) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(new Error('the image server did not answer within 5 minutes')), timeoutMs);
            const onAbort = () => controller.abort(signal?.reason);
            signal?.addEventListener?.('abort', onAbort, { once: true });
            try {
                const base = String(service.url || '').trim().replace(/\/+$/u, '');
                if (!/^https?:\/\//u.test(base)) throw Object.assign(new Error('the image service URL is missing'), { serverDown: true });
                if (service.provider === 'openai-images') {
                    const tools = await getHelpers();
                    const key = tools.readSecret ? tools.readSecret(directories, 'api_key_custom', service.secretId || null) : readSecretFromFile(directories, 'api_key_custom', service.secretId);
                    const negative = String(payload.negative_prompt || '').trim();
                    const upstream = await fetchImpl(`${base}/v1/images/generations`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
                        body: JSON.stringify({
                            ...(service.model ? { model: String(service.model) } : {}),
                            prompt: negative ? `${payload.prompt}\n\nAvoid: ${negative}` : payload.prompt,
                            n: 1,
                            size: `${payload.width}x${payload.height}`,
                            response_format: 'b64_json',
                            // Honoured by the services that take one; ignored by the rest.
                            ...(Number.isInteger(payload.seed) ? { seed: payload.seed } : {}),
                        }),
                        signal: controller.signal,
                    });
                    if (!upstream.ok) throw Object.assign(new Error(`the image service answered ${upstream.status}: ${(await upstream.text().catch(() => '')).slice(0, 200)}`), { serverDown: upstream.status >= 500 });
                    const body = await upstream.json();
                    const image = (Array.isArray(body?.data) ? body.data : []).map(item => item?.b64_json).find(Boolean);
                    if (!image) throw new Error('the image service sent no picture');
                    return { image, seed: seedOf(body?.seed ?? body?.data?.[0]?.seed, payload.seed) };
                }
                const upstream = await fetchImpl(`${base}/sdapi/v1/txt2img`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...basicAuth(service.auth) },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
                if (!upstream.ok) throw Object.assign(new Error(`the image server answered ${upstream.status}`), { serverDown: upstream.status >= 500 });
                const body = await upstream.json();
                const image = Array.isArray(body?.images) ? body.images[0] : null;
                if (!image) throw new Error('the image server sent no picture');
                return { image, seed: seedOf(body?.info, payload.seed) };
            } catch (error) {
                if (controller.signal.aborted && !signal?.aborted) throw Object.assign(new Error(String(controller.signal.reason?.message || 'the image server did not answer')), { serverDown: true });
                if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed/u.test(String(error?.cause?.code || error?.cause?.message || error?.message || ''))) {
                    throw Object.assign(new Error(`the image server is not reachable: ${error?.message || error}`), { serverDown: true });
                }
                throw error;
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener?.('abort', onAbort);
            }
        },

        /**
         * The server's picture (a 1024px PNG of about 1.5 MB from Local Dream)
         * as a square cropped from the top (384px for a portrait, larger for
         * a picture sent in a conversation), WebP when Jimp can encode it,
         * else JPEG, else the original PNG.
         */
        async shrink(base64, { side: wanted = PORTRAIT_SIDE } = {}) {
            const original = Buffer.from(String(base64 || ''), 'base64');
            const tools = await getHelpers();
            if (!tools.Jimp) return { buffer: original, format: 'png' };
            try {
                const image = await tools.Jimp.fromBuffer(original);
                const side = Math.min(image.bitmap.width, image.bitmap.height);
                image.crop({ x: Math.floor((image.bitmap.width - side) / 2), y: 0, w: side, h: side });
                const target = Math.max(64, Math.min(1024, Number(wanted) || PORTRAIT_SIDE, side));
                image.resize({ w: target, h: target });
                for (const [mime, format] of [[tools.JimpMime?.webp || 'image/webp', 'webp'], [tools.JimpMime?.jpeg || 'image/jpeg', 'jpg']]) {
                    try {
                        const buffer = await image.getBuffer(mime, { quality: 86 });
                        if (buffer?.length) return { buffer: Buffer.from(buffer), format };
                    } catch (error) {
                        log(`portrait ${format} encode failed: ${error?.message || error}`);
                    }
                }
            } catch (error) {
                log(`could not shrink a portrait; keeping it full size: ${error?.message || error}`);
            }
            return { buffer: original, format: 'png' };
        },

        /** Removes a file `savePortrait` wrote (a picture whose world was deleted while it was drawn). */
        async removePortrait({ directories, path: webPath }) {
            const imagesRoot = directories?.userImages || path.join(directories?.root || path.join(process.cwd(), 'data', 'default-user'), 'user', 'images');
            const file = path.join(imagesRoot, PORTRAIT_FOLDER, path.basename(String(webPath || '')));
            if (!path.basename(String(webPath || ''))) return false;
            try {
                await fs.promises.unlink(file);
                return true;
            } catch (error) {
                if (error?.code !== 'ENOENT') log(`could not remove ${file}: ${error?.message || error}`);
                return false;
            }
        },

        /** Writes a portrait under user/images/InnerLore and returns the path the page uses. */
        async savePortrait({ directories, fileName, buffer, format }) {
            const imagesRoot = directories?.userImages || path.join(directories?.root || path.join(process.cwd(), 'data', 'default-user'), 'user', 'images');
            const folder = path.join(imagesRoot, PORTRAIT_FOLDER);
            await fs.promises.mkdir(folder, { recursive: true });
            const file = path.join(folder, `${sanitizeFileName(fileName)}.${format}`);
            await fs.promises.writeFile(file, buffer);
            const root = directories?.root || path.dirname(path.dirname(imagesRoot));
            return file.startsWith(root) ? file.slice(root.length).split(path.sep).join('/') : `/user/images/${PORTRAIT_FOLDER}/${path.basename(file)}`;
        },
    };
}
