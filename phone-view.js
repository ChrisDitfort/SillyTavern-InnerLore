/**
 * The phone: a full screen for private conversations, styled like a
 * messaging app. Home lists the conversations so far, the people who can be
 * reached and how, and the contacts the player holds; a thread shows one
 * conversation as bubbles with a composer. The screen knows nothing about
 * models or the story: index.js hands it a model and takes its callbacks.
 */
import { escapeHtml } from './core.js?v=48';
import { CHANNELS } from './private-chat.js?v=1';

const STYLE_ID = 'il_phone_inline_styles_v1';
const STYLES = `
/* An explicit size: a theme or extension can transform <html>, and inset:0 then measures against it, not the screen. */
.il-phone-screen{--il-gold:#ecd9ac;--il-line:rgba(255,255,255,.09);--il-muted:#8f99a8;--il-mind:#a78bfa;position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:43000;background:#070a0f;display:flex;justify-content:center;color:#d6dbe4;font-size:14px;line-height:1.38}
.il-phone-screen *{box-sizing:border-box}
.il-phone-panel{width:100%;max-width:720px;height:100%;display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);background:#0b0f16}
.il-phone-head{display:flex;align-items:center;gap:10px;padding:10px 12px 9px;border-bottom:1px solid var(--il-line);background:linear-gradient(180deg,rgba(24,29,40,.98),rgba(12,15,22,.98))}
.il-phone-btn{flex:none;width:38px;height:38px;border-radius:12px;border:1px solid var(--il-line);background:rgba(255,255,255,.04);color:#cfd6e0;display:grid;place-items:center;cursor:pointer;padding:0;font:inherit}
.il-phone-btn:hover{border-color:rgba(226,201,154,.45);color:var(--il-gold)}
.il-phone-btn svg{width:18px;height:18px}
.il-phone-btn.is-text{min-width:38px;width:auto;padding:0 12px;font-size:.86em}
.il-phone-who{flex:1;min-width:0;display:flex;flex-direction:column}
.il-phone-who b{font-weight:650;color:var(--il-gold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-phone-who small{color:var(--il-muted);font-size:.8em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-phone-face{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-size:.72em;font-weight:700;color:#0d1017;background:hsl(var(--hue,40) 45% 70%);overflow:hidden;cursor:pointer}
.il-phone-face.has-portrait{background:#1b2130}
.il-phone-face img{width:100%;height:100%;object-fit:cover;display:block}
.il-phone-chip{flex:none;font-size:.66em;letter-spacing:.12em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid var(--il-line);color:#c9cfd9}
.il-phone-chip.is-mind{border-color:rgba(167,139,250,.55);color:#d6c9ff}
.il-phone-chip.is-aside{border-color:rgba(142,230,162,.45);color:#bfeec9}
.il-phone-chip.is-text{border-color:rgba(226,201,154,.45);color:var(--il-gold)}
.il-phone-body{flex:1;overflow-y:auto;padding:6px 14px calc(18px + env(safe-area-inset-bottom,0px))}
.il-phone-section{margin:14px 0 6px;font-size:.68em;letter-spacing:.16em;text-transform:uppercase;color:#7d8796;font-weight:600}
.il-phone-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.il-phone-row{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:1px solid var(--il-line);border-radius:12px;background:rgba(255,255,255,.03);color:inherit;font:inherit;text-align:left;cursor:pointer}
.il-phone-row:hover{background:rgba(255,255,255,.05)}
.il-phone-row .il-phone-main{flex:1;min-width:0}
.il-phone-row b{display:block;font-weight:600;color:#e4e8ef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-phone-row small{display:block;color:var(--il-muted);font-size:.82em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-phone-row .il-phone-time{flex:none;font-size:.72em;color:#6d7684;align-self:flex-start;margin-top:2px}
.il-phone-row.is-static{cursor:default}
.il-phone-row.is-static:hover{background:rgba(255,255,255,.03)}
.il-phone-ways{display:flex;gap:6px;flex:none}
.il-phone-way{border:1px solid rgba(226,201,154,.38);background:rgba(226,201,154,.09);color:var(--il-gold);border-radius:9px;padding:6px 10px;font:inherit;font-size:.8em;cursor:pointer;white-space:nowrap}
.il-phone-way.is-mind{border-color:rgba(167,139,250,.5);background:rgba(167,139,250,.12);color:#d6c9ff}
.il-phone-way.is-aside{border-color:rgba(142,230,162,.4);background:rgba(142,230,162,.1);color:#bfeec9}
.il-phone-way.is-unknown{border-style:dashed}
.il-phone-empty{color:#6d7684;font-style:italic;font-size:.88em;margin:6px 0}
.il-phone-note{padding:10px 12px;margin:8px 0;border-radius:12px;border:1px dashed rgba(226,201,154,.38);color:#d9c9a3;font-size:.9em}
.il-sms-log{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:12px 14px}
.il-sms-bubble{max-width:80%;padding:8px 12px;border-radius:17px;line-height:1.35;font-size:.96em;white-space:pre-wrap;overflow-wrap:anywhere}
.il-sms-bubble.is-person{align-self:flex-start;background:#1e2634;color:#e2e7ef;border-bottom-left-radius:5px}
.il-sms-bubble.is-player{align-self:flex-end;background:linear-gradient(135deg,#7a6230,#9a7a35);color:#fff7e2;border-bottom-right-radius:5px}
.il-sms-bubble.is-note{align-self:center;max-width:92%;background:none;color:var(--il-muted);font-size:.8em;font-style:italic;text-align:center;padding:2px 8px}
.il-sms-bubble.is-pending{opacity:.72}
.il-sms-day{align-self:center;font-size:.68em;letter-spacing:.08em;text-transform:uppercase;color:#6d7684;margin:4px 0}
.is-mind .il-sms-bubble.is-person{background:#241f3a;color:#e6dcff;font-style:italic;box-shadow:0 0 16px rgba(140,110,230,.22)}
.is-mind .il-sms-bubble.is-player{background:linear-gradient(135deg,#4c3a86,#6a4fb8);color:#f3edff;font-style:italic}
.is-aside .il-sms-bubble.is-person{background:#1c2a22;color:#e2efe5}
.is-aside .il-sms-bubble.is-player{background:linear-gradient(135deg,#3b5e45,#4f7a5a);color:#eefbf1}
.il-sms-typing{align-self:flex-start;display:inline-flex;gap:4px;padding:11px 14px;border-radius:17px;border-bottom-left-radius:5px;background:#1e2634}
.is-mind .il-sms-typing{background:#241f3a}
.il-sms-typing span{width:7px;height:7px;border-radius:50%;background:#9aa3b0;animation:il-sms-dot 1.2s infinite ease-in-out}
.il-sms-typing span:nth-child(2){animation-delay:.2s}
.il-sms-typing span:nth-child(3){animation-delay:.4s}
@keyframes il-sms-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.il-phone-status{padding:4px 14px;font-size:.82em;color:var(--il-muted);text-align:center;min-height:1.4em}
.il-phone-status.is-closed{color:#e3b2b2}
.il-phone-compose{display:flex;align-items:flex-end;gap:8px;padding:8px 12px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--il-line);background:#0d121b}
.il-phone-compose textarea{flex:1;min-height:42px;max-height:130px;resize:none;border-radius:21px;border:1px solid var(--il-line);background:#131a26;color:#e4e8ef;padding:10px 14px;font:inherit;font-size:.96em;line-height:1.3;outline:none}
.il-phone-compose textarea:focus{border-color:rgba(226,201,154,.45)}
.il-phone-compose textarea:disabled{opacity:.5}
.il-phone-send{flex:none;width:42px;height:42px;border-radius:50%;border:0;background:linear-gradient(135deg,#8a6d2f,#c2a24d);color:#140f05;display:grid;place-items:center;cursor:pointer;padding:0}
.il-phone-send:disabled{opacity:.4;cursor:default}
.il-phone-send svg{width:20px;height:20px}
.is-mind .il-phone-send{background:linear-gradient(135deg,#6a4fb8,#9d85e6);color:#120c24}
.is-aside .il-phone-send{background:linear-gradient(135deg,#4f7a5a,#7fb48c);color:#07140b}
`;

export const PHONE_ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.5 5.2h3M11 18.6h2"/></svg>',
    aside: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9l-3.5 3v-3H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z"/><path d="M18.5 9.5h1.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2h-.5v2.5l-3-2.5h-3"/></svg>',
    mind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 20v-2.2A6.5 6.5 0 0 1 6.2 8.2 6 6 0 0 1 17.5 9.5c.6 1 1.6 2 2.3 2.8l-1.8.7v2a2 2 0 0 1-2 2h-1v3"/><path d="M9.5 10.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><circle cx="12" cy="16.3" r=".4" fill="currentColor"/></svg>',
};

function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
}

function timeLabel(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function wayButton(channel, { unknown = false } = {}) {
    const info = CHANNELS[channel];
    return `<button type="button" class="il-phone-way is-${channel}${unknown ? ' is-unknown' : ''}" data-start="${channel}" title="${escapeHtml(info.label)}${unknown ? ' (to be settled)' : ''}">${escapeHtml(info.label)}${unknown ? '…' : ''}</button>`;
}

/** The home screen: conversations, who can be reached, contacts. */
export function renderPhoneHome(model) {
    const parts = [];
    const device = model.devicePresent ? model.deviceName : '';
    if (!model.deviceKnown) {
        parts.push(`<div class="il-phone-note">Whether ${escapeHtml(model.playerName || 'you')} can send messages from afar is not settled yet. Pick someone below and the world will decide.</div>`);
    } else if (!model.devicePresent && !model.mind?.ok) {
        parts.push(`<div class="il-phone-note">No ${escapeHtml(model.deviceName || 'phone')}, and no gift of mind-speech${model.mind?.judge ? ' yet settled' : ''}: people can only be spoken to in person.</div>`);
    }
    parts.push('<div class="il-phone-section">Conversations</div>');
    if (model.threads.length) {
        parts.push(`<ul class="il-phone-list">${model.threads.map(thread => `<li><button type="button" class="il-phone-row" data-thread="${escapeHtml(thread.key)}">
            <span class="il-phone-face-slot" data-face="${escapeHtml(thread.person)}"></span>
            <span class="il-phone-main"><b>${escapeHtml(thread.person)} <span class="il-phone-chip is-${thread.channel}">${escapeHtml(CHANNELS[thread.channel].short)}</span></b><small>${escapeHtml(thread.lastFrom === 'player' ? `You: ${thread.lastText}` : thread.lastText || 'No messages yet')}</small></span>
            <span class="il-phone-time">${escapeHtml(timeLabel(thread.updated))}</span>
        </button></li>`).join('')}</ul>`);
    } else {
        parts.push('<p class="il-phone-empty">No conversations yet.</p>');
    }
    parts.push('<div class="il-phone-section">Reach someone</div>');
    if (model.reachable.length) {
        parts.push(`<ul class="il-phone-list">${model.reachable.map(person => `<li><div class="il-phone-row is-static">
            <span class="il-phone-face-slot" data-face="${escapeHtml(person.name)}" data-person="${escapeHtml(person.name)}"></span>
            <span class="il-phone-main" data-person="${escapeHtml(person.name)}"><b>${escapeHtml(person.name)}</b><small>${escapeHtml(person.present ? 'Here with you' : person.location ? `At ${person.location}` : 'Elsewhere')}</small></span>
            <span class="il-phone-ways" data-name="${escapeHtml(person.name)}">${person.channels.map(way => wayButton(way.channel, { unknown: way.unknown })).join('')}</span>
        </div></li>`).join('')}</ul>`);
    } else {
        parts.push(`<p class="il-phone-empty">Nobody can be reached from here${device ? ` by ${escapeHtml(device)}` : ''} yet. Numbers are given in the story, and a gift of the mind is a matter for the world to decide.</p>`);
    }
    parts.push(`<div class="il-phone-section">${escapeHtml(device ? `${device} contacts` : 'Contacts')}</div>`);
    if (model.contacts.length) {
        parts.push(`<ul class="il-phone-list">${model.contacts.map(contact => `<li><div class="il-phone-row is-static">
            <span class="il-phone-face-slot" data-face="${escapeHtml(contact.name)}" data-person="${escapeHtml(contact.name)}"></span>
            <span class="il-phone-main" data-person="${escapeHtml(contact.name)}"><b>${escapeHtml(contact.name)}</b><small>${escapeHtml(contact.number || 'reachable')}${contact.note ? ` · ${escapeHtml(contact.note)}` : ''}</small></span>
        </div></li>`).join('')}</ul>`);
    } else {
        parts.push(`<p class="il-phone-empty">${model.devicePresent ? 'No contacts yet: ask people for their ' + escapeHtml(/phone/iu.test(model.deviceName) ? 'number' : 'contact') + '.' : 'No contacts.'}</p>`);
    }
    return parts.join('');
}

/** One conversation as bubbles; unflushed lines are shown a little lighter. */
export function renderThreadLog(thread, { typing = false } = {}) {
    const bubbles = (thread?.bubbles || []).map(bubble => (
        `<div class="il-sms-bubble ${bubble.from === 'player' ? 'is-player' : 'is-person'}${bubble.flushed ? '' : ' is-pending'}">${escapeHtml(bubble.text)}</div>`
    ));
    if (thread?.status === 'rejected') bubbles.push(`<div class="il-sms-bubble is-note">${escapeHtml(thread.person)} shut you out.</div>`);
    else if (thread?.status === 'ended') bubbles.push(`<div class="il-sms-bubble is-note">${escapeHtml(thread.person)} ended the conversation. Writing again starts it anew.</div>`);
    if (typing) bubbles.push('<div class="il-sms-typing" aria-label="typing"><span></span><span></span><span></span></div>');
    if (!bubbles.length) bubbles.push('<div class="il-sms-bubble is-note">Nothing said yet.</div>');
    return bubbles.join('');
}

export function createPhonePanel({ faceFor = null, onSend, onOpenThread, onStart, onPerson, onBack, onClose } = {}) {
    let overlay = null;
    let panel = null;
    let model = { playerName: '', deviceKnown: false, devicePresent: false, deviceName: 'Phone', threads: [], contacts: [], reachable: [], mind: null };
    let view = 'home';
    let current = null;
    let draft = '';

    const fillFaces = root => {
        if (typeof faceFor !== 'function') return;
        for (const slot of root.querySelectorAll('.il-phone-face-slot')) {
            const name = slot.dataset.face || '';
            if (!name) continue;
            const face = faceFor(name, 'il-phone-face');
            if (face) slot.replaceWith(face);
        }
    };

    const ensure = () => {
        ensureStyles();
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'il_phone_overlay';
        overlay.className = 'il-phone-screen displayNone';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Phone');
        overlay.innerHTML = '<div class="il-phone-panel"></div>';
        panel = overlay.querySelector('.il-phone-panel');
        document.body.appendChild(overlay);
        overlay.addEventListener('click', event => {
            const target = event.target;
            if (target.closest('[data-action="close"]')) return onClose?.();
            if (target.closest('[data-action="back"]')) return onBack?.();
            if (target.closest('[data-action="send"]')) return send();
            const thread = target.closest('[data-thread]');
            if (thread) return onOpenThread?.(thread.dataset.thread);
            const start = target.closest('[data-start]');
            if (start) return onStart?.(start.closest('[data-name]')?.dataset.name || '', start.dataset.start);
            const person = target.closest('[data-person]');
            if (person) return onPerson?.(person.dataset.person);
            const face = target.closest('.il-phone-face[data-name]');
            if (face) return onPerson?.(face.dataset.name);
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (view === 'thread') onBack?.();
                else onClose?.();
            }
        });
        overlay.addEventListener('input', event => {
            if (event.target.matches('.il-phone-compose textarea')) draft = event.target.value;
        });
        overlay.addEventListener('keydown', event => {
            if (event.target.matches('.il-phone-compose textarea') && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                send();
            }
        });
    };

    const send = () => {
        const box = panel?.querySelector('.il-phone-compose textarea');
        const text = (box?.value || '').trim();
        if (!text || !current || current.canSend === false) return;
        if (box) box.value = '';
        draft = '';
        onSend?.(current.thread.key, text);
    };

    const paintHome = () => {
        panel.className = 'il-phone-panel is-home';
        const count = model.threads.length;
        panel.innerHTML = `
            <div class="il-phone-head">
                <button type="button" class="il-phone-btn" data-action="close" aria-label="Back to the story" title="Back to the story">${PHONE_ICON.back}</button>
                <div class="il-phone-who"><b>${escapeHtml(model.devicePresent ? model.deviceName : 'Phone')}</b><small>${escapeHtml(count ? `${count} conversation${count === 1 ? '' : 's'}` : model.mind?.ok ? 'Mind-speech open to you' : 'Private conversations')}</small></div>
            </div>
            <div class="il-phone-body">${renderPhoneHome(model)}</div>`;
        fillFaces(panel);
    };

    const paintThread = () => {
        const thread = current.thread;
        const channel = CHANNELS[thread.channel];
        panel.className = `il-phone-panel is-thread is-${thread.channel}`;
        const subtitle = thread.channel === 'aside'
            ? (current.placeName ? `Quietly, at ${current.placeName}` : 'Quietly, aside from the others')
            : (current.location ? `At ${current.location}` : current.present ? 'Here with you' : 'Elsewhere');
        panel.innerHTML = `
            <div class="il-phone-head">
                <button type="button" class="il-phone-btn" data-action="back" aria-label="All conversations" title="All conversations">${PHONE_ICON.back}</button>
                <span class="il-phone-face-slot" data-face="${escapeHtml(thread.person)}"></span>
                <div class="il-phone-who" data-person="${escapeHtml(thread.person)}" style="cursor:pointer"><b>${escapeHtml(thread.person)}</b><small>${escapeHtml(subtitle)}</small></div>
                <span class="il-phone-chip is-${thread.channel}">${escapeHtml(channel.short)}</span>
                <button type="button" class="il-phone-btn is-text" data-action="close" title="Close and let the story know">Done</button>
            </div>
            <div class="il-sms-log">${renderThreadLog(thread, { typing: current.status?.kind === 'typing' })}</div>
            <div class="il-phone-status${current.status?.kind === 'closed' || current.status?.kind === 'blocked' ? ' is-closed' : ''}">${escapeHtml(current.status?.text || (current.status?.kind === 'typing' ? `${thread.person} is ${thread.channel === 'text' ? 'typing' : thread.channel === 'mind' ? 'thinking' : 'answering'}…` : ''))}</div>
            <div class="il-phone-compose">
                <textarea rows="1" placeholder="${escapeHtml(current.canSend === false ? (current.blockedReason || 'Nothing more can be said') : `${channel.composer} as ${model.playerName || 'yourself'}…`)}" ${current.canSend === false ? 'disabled' : ''}></textarea>
                <button type="button" class="il-phone-send" data-action="send" aria-label="Send" ${current.canSend === false ? 'disabled' : ''}>${PHONE_ICON.send}</button>
            </div>`;
        fillFaces(panel);
        const face = panel.querySelector('.il-phone-head .il-phone-face');
        if (face) face.dataset.name = thread.person;
        const box = panel.querySelector('.il-phone-compose textarea');
        if (box && draft) box.value = draft;
        const log = panel.querySelector('.il-sms-log');
        if (log) log.scrollTop = log.scrollHeight;
    };

    const paint = () => {
        if (!overlay || overlay.classList.contains('displayNone')) return;
        if (view === 'thread' && current) paintThread();
        else paintHome();
    };

    return {
        open() {
            ensure();
            overlay.classList.remove('displayNone');
            paint();
            if (view === 'thread' && current?.canSend !== false) {
                const box = panel.querySelector('.il-phone-compose textarea');
                box?.focus({ preventScroll: true });
            }
        },
        refresh(next) {
            model = { ...model, ...(next || {}) };
            if (view === 'home') paint();
        },
        showHome() {
            view = 'home';
            current = null;
            draft = '';
            paint();
        },
        showThread(data) {
            if (!data?.thread) return this.showHome();
            if (current?.thread?.key !== data.thread.key) draft = '';
            view = 'thread';
            current = data;
            paint();
        },
        close() {
            overlay?.classList.add('displayNone');
        },
        isOpen: () => Boolean(overlay && !overlay.classList.contains('displayNone')),
        view: () => view,
        threadKey: () => current?.thread?.key || '',
    };
}
