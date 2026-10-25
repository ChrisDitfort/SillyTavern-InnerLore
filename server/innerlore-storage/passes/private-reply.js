/**
 * The private-reply job: the other person's answer in a quiet word, a text
 * or a thought. The page builds the messages (it holds the thread and the
 * world packet) and names the connection; the server sends the request and
 * keeps the answer in the job's result, so a tab that slept through the
 * reply still finds it on waking.
 */
export function createPrivateReplyJob({ llm, log = () => {} }) {
    return async function runPrivateReply(job, tools) {
        const input = job.input || {};
        const messages = Array.isArray(input.messages) ? input.messages.filter(message => message && typeof message.content === 'string') : [];
        if (!messages.length) throw new Error('the private reply has no messages');
        if (!input.connection) throw new Error('the private reply names no connection');
        tools.setDetail(`${input.person || 'someone'} is answering`);
        const text = await llm.request({
            connection: input.connection,
            fallback: null,
            messages,
            maxTokens: Math.max(60, Math.min(600, Number(input.maxTokens) || 220)),
            temperature: Math.max(0, Math.min(1.5, Number(input.temperature ?? 0.8))),
            names: input.names || {},
            directories: job.directories,
            signal: tools.signal,
            attempts: 2,
            timeoutMs: 120_000,
            breakerMs: 150_000,
            kind: 'private',
        });
        log(`${input.person || 'someone'} answered (${String(text).length} characters)`);
        return { text: String(text) };
    };
}
