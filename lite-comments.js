// @ts-check

// 映像モード「軽量」のコメント表示（映像の上に流す。表示のみ）。lite.js から使う。
// ・コメントは視聴セッションの messageServer で届く viewUri（mpn.live.nicovideo.jp）から protobuf で受け取る。
//   形式は N Air の公開定義（n-air-app/nicolive-comment-protobuf）の ChunkedEntry / ChunkedMessage。
//   view を ?at=now → ?at=<次の時刻> と聞き続け、届いた 16 秒ごとの segment を並行して読み続ける。
// ・流す時刻は vpos（投稿者が見ていた映像の位置）基準。自分の映像の位置（HLS の PROGRAM-DATE-TIME 由来）が
//   vposBaseTime + vpos に達したら流すので、映像の遅れに合わせてコメントも遅れて出る（公式と同じ考え方）。
// ・描画は1コメント1要素を Web Animations で動かす。動きはブラウザの合成処理が受け持つので、
//   JavaScript が動くのはコメントを出す瞬間だけ（毎フレーム描き直す canvas 方式より軽い）。
// ・非公開仕様に頼るので、受信に失敗しても映像の再生には影響させない（黙って再試行する）。

/**
 * @typedef {Object} LiteComment
 * @property {string} text
 * @property {number} due   流す時刻（ms。映像の時刻基準）
 * @property {number} pos   0=流れる 1=下に固定 2=上に固定
 * @property {number} size  0=普通 1=小 2=大
 * @property {string} color
 * @property {boolean} translucent
 */

/**
 * 表示中のコメント（重なり判定に使う位置と時間）
 * @typedef {Object} ActiveComment
 * @property {HTMLElement} el
 * @property {number} w
 * @property {number} h
 * @property {number} y
 * @property {number} pos
 * @property {number} start
 * @property {number} end
 * @property {number} v  流れる速さ（px/ms）
 */

/**
 * @param {HTMLVideoElement} video
 * @param {() => number} getVideoTime 映像の現在位置の時刻（ms）
 */
function createLiteCommentLayer(video, getVideoTime) {
    const NAKA_MS = 4000;      // 流れるコメントが右端から左端へ抜けるまで
    const FIXED_MS = 3000;     // 上・下に固定するコメントの表示時間
    const MAX_ACTIVE = 80;     // 同時に表示する上限（超えた分は出さない＝重くしない）
    const MAX_QUEUE = 500;
    const LATE_DROP_MS = 5000; // 流す時刻をこれ以上過ぎていたら出さない（止まっていた後の一斉表示を防ぐ）
    const SIZE_SCALE = [1, 0.625, 1.625];
    // NamedColor（white, red, pink, orange, yellow, green, cyan, blue, purple, black と、その2系）
    const COLORS = [
        '#ffffff', '#ff0000', '#ff8080', '#ffc000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#c000ff', '#000000',
        '#cccc99', '#cc0033', '#ff33cc', '#ff6600', '#999900', '#00cc66', '#00cccc', '#3399ff', '#6633cc', '#666666',
    ];

    const layer = document.createElement('div');
    layer.id = 'lite_comments';
    layer.hidden = true;
    video.after(layer);

    let enabled = false;
    /** @type {{ viewUri: string, vposBase: number, wpxb: string } | null} */
    let server = null;
    /** @type {AbortController | null} */
    let client = null;
    /** @type {LiteComment[]} */
    const queue = [];
    /** @type {ActiveComment[]} */
    const active = [];
    let timer = 0;
    let W = 0;
    let H = 0;

    // ===== 配置（映像の絵の部分にだけ重ねる。黒帯には出さない） =====

    function layout() {
        const cw = video.clientWidth;
        const ch = video.clientHeight;
        const vw = video.videoWidth || 16;
        const vh = video.videoHeight || 9;
        const scale = Math.min(cw / vw, ch / vh);
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));
        layer.style.left = `${Math.round((cw - w) / 2)}px`;
        layer.style.top = `${Math.round((ch - h) / 2)}px`;
        if (w === W && h === H) return; // 画質が変わっただけ（絵の大きさは同じ）なら流れている分はそのまま
        W = w;
        H = h;
        layer.style.width = `${W}px`;
        layer.style.height = `${H}px`;
        clearActive(); // 大きさが変わると文字の大きさも変わるので、流れている分は消して次から新しい大きさで出す
    }
    window.addEventListener('resize', layout);
    video.addEventListener('resize', layout); // 画質が変わって映像の縦横が変わったとき
    video.addEventListener('playing', () => schedule()); // 一時停止から戻ったら、止めていた予定を再開する
    layout();

    // ===== 表示 =====

    /**
     * コメントの要素を作って大きさを測る（画面に収まらない分は文字を小さくする）
     * @param {LiteComment} c
     */
    function createElement(c) {
        const el = document.createElement('div');
        el.className = c.color === '#000000' ? 'lite_comment lite_comment_dark' : 'lite_comment';
        el.textContent = c.text;
        el.style.color = c.color;
        if (c.translucent) el.style.opacity = '0.5';
        let fontPx = Math.max(10, H * 0.0625 * SIZE_SCALE[c.size]);
        el.style.fontSize = `${fontPx}px`;
        layer.appendChild(el);
        let w = el.offsetWidth;
        let h = el.offsetHeight;
        // 画面より背の高いコメント（アスキーアート等）や、画面より幅の広い固定コメントは縮めて収める
        const fit = Math.min(1, H / h, c.pos === 0 ? 1 : W / w);
        if (fit < 1) {
            fontPx *= fit;
            el.style.fontSize = `${fontPx}px`;
            w = el.offsetWidth;
            h = el.offsetHeight;
        }
        return { el, w, h };
    }

    /**
     * 流れるコメント同士がぶつかるか（同じ高さで、前の後端が入りきっていない／後ろが速くて追いつく）
     * @param {ActiveComment} e
     * @param {number} y
     * @param {number} h
     * @param {number} now
     * @param {number} v
     */
    function nakaCollides(e, y, h, now, v) {
        if (e.pos !== 0 || e.y >= y + h || e.y + e.h <= y) return false;
        if (W + e.w - (now - e.start) * e.v > W) return true;
        return v > e.v && W - (e.end - now) * v < 0;
    }

    /**
     * 空いている高さを上（下に固定するものは下）から探す。空きがなければ重ねる（公式と同じ）
     * @param {number} h
     * @param {(y: number) => ActiveComment | undefined} hitAt
     * @param {boolean} fromBottom
     */
    function findY(h, hitAt, fromBottom) {
        if (fromBottom) {
            for (let y = H - h; y >= 0;) {
                const hit = hitAt(y);
                if (!hit) return y;
                y = hit.y - h;
            }
        } else {
            for (let y = 0; y + h <= H;) {
                const hit = hitAt(y);
                if (!hit) return y;
                y = hit.y + hit.h;
            }
        }
        return Math.random() * Math.max(0, H - h);
    }

    /** @param {LiteComment} c */
    function place(c) {
        if (active.length >= MAX_ACTIVE) return;
        const now = performance.now();
        const { el, w, h } = createElement(c);
        /** @type {ActiveComment} */
        let rec;
        /** @type {Animation} */
        let anim;
        if (c.pos === 0) {
            const v = (W + w) / NAKA_MS;
            const y = findY(h, (yy) => active.find((e) => nakaCollides(e, yy, h, now, v)), false);
            el.style.top = `${y}px`;
            anim = el.animate(
                [{ transform: `translateX(${W}px)` }, { transform: `translateX(${-w}px)` }],
                { duration: NAKA_MS, easing: 'linear' },
            );
            rec = { el, w, h, y, pos: 0, start: now, end: now + NAKA_MS, v };
        } else {
            const y = findY(h, (yy) => active.find((e) => e.pos === c.pos && e.y < yy + h && e.y + e.h > yy), c.pos === 1);
            el.style.top = `${y}px`;
            el.style.left = `${(W - w) / 2}px`;
            anim = el.animate([], { duration: FIXED_MS }); // 表示時間を数えるだけ
            rec = { el, w, h, y, pos: c.pos, start: now, end: now + FIXED_MS, v: 0 };
        }
        active.push(rec);
        anim.onfinish = () => {
            el.remove();
            const i = active.indexOf(rec);
            if (i >= 0) active.splice(i, 1);
        };
    }

    function clearActive() {
        for (const e of active) e.el.remove();
        active.length = 0;
    }

    // 流す時刻が来たコメントを出し、次の予定時刻に起きる（何もない間は止まっている）。
    // 一時停止中は映像の時刻が進まず、同じ予定で起き続けてしまうので止めておき、再生が戻ったら（playing）再開する
    function schedule() {
        clearTimeout(timer);
        timer = 0;
        if (!enabled || !queue.length || video.paused) return;
        const vt = getVideoTime();
        let nextDue = Infinity;
        for (let i = 0; i < queue.length;) {
            const c = queue[i];
            if (c.due <= vt) {
                queue.splice(i, 1);
                if (vt - c.due <= LATE_DROP_MS) place(c);
            } else {
                nextDue = Math.min(nextDue, c.due);
                i++;
            }
        }
        if (queue.length) timer = window.setTimeout(schedule, Math.min(1000, Math.max(30, nextDue - vt)));
    }

    function clearAll() {
        queue.length = 0;
        clearTimeout(timer);
        timer = 0;
        clearActive();
    }

    let scheduleQueued = false;
    /** @param {LiteComment} c */
    function enqueue(c) {
        queue.push(c);
        if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
        // まとめて届いたコメント（segment の読み始めなど）は、届き終わってから1回だけ予定を立てる。
        // 受信は for await で1件ずつマイクロタスクを挟んで届くので、次のタスク（setTimeout）まで待つ
        if (scheduleQueued) return;
        scheduleQueued = true;
        window.setTimeout(() => {
            scheduleQueued = false;
            schedule();
        }, 0);
    }

    // ===== 受信（protobuf） =====

    /**
     * 可変長整数を読む。足りなければ null
     * @param {Uint8Array} buf
     * @param {number} pos
     * @returns {[number, number] | null} [値, 次の位置]
     */
    function readVarint(buf, pos) {
        let value = 0;
        let mul = 1;
        for (let i = pos; i < buf.length && i < pos + 10; i++) {
            value += (buf[i] & 0x7f) * mul;
            if (!(buf[i] & 0x80)) return [value, i + 1];
            mul *= 128;
        }
        return null;
    }

    /**
     * メッセージの必要な項目だけを取り出す（spec: 項目番号 → 名前。長さ付きは Uint8Array、整数は number）
     * @param {Uint8Array} buf
     * @param {Record<number, string>} spec
     * @returns {Record<string, any>}
     */
    function pb(buf, spec) {
        /** @type {Record<string, any>} */
        const out = {};
        let pos = 0;
        while (pos < buf.length) {
            const tag = readVarint(buf, pos);
            if (!tag) break;
            pos = tag[1];
            const field = Math.floor(tag[0] / 8);
            const wire = tag[0] & 7;
            /** @type {any} */
            let value;
            if (wire === 0) {
                const v = readVarint(buf, pos);
                if (!v) break;
                value = v[0];
                pos = v[1];
            } else if (wire === 2) {
                const len = readVarint(buf, pos);
                if (!len) break;
                value = buf.subarray(len[1], len[1] + len[0]);
                pos = len[1] + len[0];
            } else if (wire === 1) {
                pos += 8;
            } else if (wire === 5) {
                pos += 4;
            } else {
                break; // 未知の形式は読まない
            }
            if (spec[field] && value !== undefined) out[spec[field]] = value;
        }
        return out;
    }

    const textDecoder = new TextDecoder();

    /** @param {Uint8Array | undefined} b Timestamp → ms */
    function timestampMs(b) {
        if (!b) return NaN;
        const t = pb(b, { 1: 'seconds', 2: 'nanos' });
        return (t.seconds || 0) * 1000 + Math.floor((t.nanos || 0) / 1e6);
    }

    /**
     * ChunkedMessage からコメント（Chat）を取り出す
     * @param {Uint8Array} b
     * @param {number} vposBase
     * @returns {LiteComment | null}
     */
    function decodeChat(b, vposBase) {
        const cm = pb(b, { 1: 'meta', 2: 'message' });
        if (!cm.message) return null;
        const chatBuf = pb(cm.message, { 1: 'chat' }).chat;
        if (!chatBuf) return null;
        const chat = pb(chatBuf, { 1: 'content', 3: 'vpos', 7: 'modifier' });
        if (!chat.content) return null;
        const text = textDecoder.decode(chat.content).slice(0, 300);
        const at = cm.meta ? timestampMs(pb(cm.meta, { 2: 'at' }).at) : NaN;
        // vpos は int32。負の値（10バイトの可変長整数）は使わない
        const vpos = typeof chat.vpos === 'number' && chat.vpos < 2 ** 31 ? chat.vpos : NaN;
        const due = Number.isFinite(vposBase) && Number.isFinite(vpos) ? vposBase + vpos * 10 : at;
        if (!Number.isFinite(due)) return null;
        const m = chat.modifier ? pb(chat.modifier, { 1: 'pos', 2: 'size', 3: 'named', 4: 'full', 6: 'opacity' }) : {};
        let color = COLORS[m.named || 0] || COLORS[0];
        if (m.full) {
            const f = pb(m.full, { 1: 'r', 2: 'g', 3: 'b' });
            color = `rgb(${f.r || 0}, ${f.g || 0}, ${f.b || 0})`;
        }
        return {
            text,
            due,
            pos: m.pos === 1 || m.pos === 2 ? m.pos : 0,
            size: m.size === 1 || m.size === 2 ? m.size : 0,
            color,
            translucent: m.opacity === 1,
        };
    }

    /**
     * 長さ付きメッセージが続くストリームを、届いた分から1件ずつ返す
     * @param {string} url
     * @param {AbortSignal} signal
     */
    async function* readDelimited(url, signal) {
        const res = await fetch(url, { signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        const reader = res.body.getReader();
        let buf = new Uint8Array(0);
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) return;
                const merged = new Uint8Array(buf.length + value.length);
                merged.set(buf);
                merged.set(value, buf.length);
                buf = merged;
                for (;;) {
                    const len = readVarint(buf, 0);
                    if (!len || buf.length < len[1] + len[0]) break;
                    yield buf.slice(len[1], len[1] + len[0]);
                    buf = buf.subarray(len[1] + len[0]);
                }
            }
        } finally {
            reader.cancel().catch(() => { });
        }
    }

    /**
     * @param {string} uri
     * @param {Record<string, string | number>} params
     */
    function withParams(uri, params) {
        const u = new URL(uri);
        for (const [k, v] of Object.entries(params)) {
            if (v !== '') u.searchParams.set(k, String(v));
        }
        return u.toString();
    }

    /** @param {number} ms */
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // view を聞き続け、新しい segment が来たら読み始める
    /**
     * @param {AbortSignal} signal
     * @param {{ viewUri: string, vposBase: number, wpxb: string }} s
     */
    async function runView(signal, s) {
        /** @type {Set<string>} */
        const seen = new Set();
        /** @type {string | number} */
        let at = 'now';
        let errors = 0;
        while (!signal.aborted) {
            /** @type {number | null} */
            let next = null;
            try {
                for await (const b of readDelimited(withParams(s.viewUri, { at, WpXb: s.wpxb }), signal)) {
                    const entry = pb(b, { 1: 'segment', 4: 'next' });
                    if (entry.segment) {
                        const uri = pb(entry.segment, { 3: 'uri' }).uri;
                        const segUri = uri ? textDecoder.decode(uri) : '';
                        if (segUri && !seen.has(segUri)) {
                            seen.add(segUri);
                            if (seen.size > 50) seen.delete(seen.values().next().value);
                            runSegment(signal, segUri, s);
                        }
                    } else if (entry.next) {
                        next = pb(entry.next, { 1: 'at' }).at ?? null;
                    }
                }
                errors = 0;
            } catch (e) {
                if (signal.aborted) return;
                errors++;
                await sleep(Math.min(30000, 1000 * 2 ** Math.min(errors, 5)));
                // 失敗のあとは今の時刻から聞き直す（古い位置から聞くと、もう流せない過去の分がまとめて届くため）
                at = 'now';
                continue;
            }
            if (next !== null) at = next;
            else await sleep(1000); // next が来ないまま閉じた → 少し待って聞き直す
        }
    }

    /**
     * @param {AbortSignal} signal
     * @param {string} segUri
     * @param {{ viewUri: string, vposBase: number, wpxb: string }} s
     */
    async function runSegment(signal, segUri, s) {
        try {
            for await (const b of readDelimited(withParams(segUri, { WpXb: s.wpxb }), signal)) {
                if (!enabled) return;
                const c = decodeChat(b, s.vposBase);
                if (c) enqueue(c);
            }
        } catch (e) {
            // segment 単位の失敗は無視（view から次の segment が来る）
        }
    }

    function restartClient() {
        if (client) client.abort();
        client = null;
        if (enabled && server) {
            client = new AbortController();
            runView(client.signal, server);
        }
    }

    return {
        get enabled() {
            return enabled;
        },
        /** @param {boolean} on */
        setEnabled(on) {
            if (enabled === on) return;
            enabled = on;
            layer.hidden = !on;
            if (!on) clearAll();
            else layout();
            restartClient();
        },
        /**
         * コメントの配信元（視聴セッションの messageServer）。null で切断
         * @param {string | null} viewUri
         * @param {string} [vposBaseTime]
         * @param {string} [wpxb] 公式プレイヤーと同じく付ける識別情報
         */
        setServer(viewUri, vposBaseTime, wpxb) {
            if (server && viewUri && server.viewUri === viewUri) return;
            server = viewUri ? { viewUri, vposBase: Date.parse(vposBaseTime || ''), wpxb: wpxb || '' } : null;
            clearAll();
            restartClient();
        },
    };
}
