// @ts-check

// 映像モード「軽量」（screenmode=3）の別窓プレイヤー。
// 公式の視聴ページは React 本体・コメント描画・ニコ生ゲーム等で JS が約3.4MB あり、別窓を開くたびに
// その全部が動く。軽量モードでは公式のスクリプトを動かさず、視聴セッション(WebSocket)と HLS だけで
// 映像を再生する（hls.js を同梱）。
// ・公式のスクリプトは、拡張の通信ルール（rules.json）が軽量の URL にだけ付ける CSP で止める
//   （declarativeNetRequestWithHostAccess。権限の警告は増えない）。HTML は普通に解析が終わるので、
//   描画も窓の仕組み（main.js の別窓追跡・SW の前面化）も他モードと同じまま。
//   ※ window.stop() で止めると描画が始まらず（音声だけで真っ白）、document.open() で作り直すと
//     本ページが別窓に付けたイベント（閉じた検知）まで消えて窓の追跡が壊れるため、どちらも使わない。
// ・live.nicovideo.jp 上の content script から通信するので、配信 CDN の CORS（ACAO=https://live.nicovideo.jp）と
//   署名 Cookie（stream メッセージの cookies を document.cookie で設定。公式プレイヤーと同じ）を満たせる。
// ・視聴プロトコルは非公開仕様なので、再生に至らなければ従来のシンプル表示（screenmode=1）へ自動で切り替える。

(() => {
    const pageUrl = new URL(location.href);
    if (pageUrl.searchParams.get('popup') !== 'on' || pageUrl.searchParams.get('screenmode') !== '3') return;
    const programId = (pageUrl.pathname.match(/^\/watch\/(lv\d+)/) || [])[1];
    if (!programId) return;

    // CSP が付いていない（公式のスクリプトが動いてしまう）ときは、すぐ通常表示に切り替える
    if (!officialScriptsBlocked()) {
        console.info('別窓くん（軽量）: スクリプト停止のルールが効いていないため通常表示に切り替えます');
        location.replace(simpleModeUrl());
        return;
    }

    const WATCH_URL = `https://live.nicovideo.jp/watch/${programId}`;
    /** 初回の再生開始までの猶予。過ぎたら通常表示へ切り替える */
    const START_TIMEOUT_MS = 20000;
    /** 再生中に映像が進まなくなってから再接続するまでの時間 */
    const STALL_TIMEOUT_MS = 15000;
    /** 再生中の失敗で自動再接続する上限（再生できたら 0 に戻る） */
    const MAX_RESTARTS = 5;
    const VOLUME_KEY = 'betsumado_lite_volume';

    // 「窓に合わせる」でもこれより下の画質には下げない（480p 相当の長辺）。
    // ニコ生の低い画質（288p 以下）はビットレートが 0.2〜0.5Mbps と低く、小窓でも粗く見えるため。
    const MIN_LONG_SIDE = 854;
    // 公式プレイヤーが「画質」の選択を保存している場所（LeoPlayer / EdgeStreamStore。値は JSON 文字列）
    const SITE_QUALITY_KEY = 'LeoPlayer_EdgeStreamStore_LATEST_DMC_STREAM_QUALITY';

    // 小窓・多窓向けに軽く再生する設定（画質の上限は capLevelToWindow で窓の大きさに合わせる）。
    // ・lowLatencyMode: false: LL-HLS の部分セグメント（0.5秒ごと）を取らず、通常セグメントだけ取る（通信回数を減らす。遅延は数秒増える）
    // ・backBufferLength: 再生済みバッファを溜めない（メモリを抑える）
    // ・withCredentials: CDN の Cookie（署名・dlive_bid）を送る
    // ・enableWorker: false: CSP（script-src 'none'）で Worker は作れない。配信は fMP4 なので変換処理は軽く、Worker は不要
    // ・autoStartLoad: false: 画質の上限と開始画質を決めてから読み込みを始める（playHls）
    const HLS_CONFIG = {
        autoStartLoad: false,
        enableWorker: false,
        lowLatencyMode: false,
        backBufferLength: 10,
        maxBufferLength: 15,
        xhrSetup: (/** @type {XMLHttpRequest} */ xhr) => { xhr.withCredentials = true; },
    };

    // 切断理由のうち、再接続しても直らないもの（公式プレイヤーの文言に合わせる）
    /** @type {Record<string, string>} */
    const TERMINAL_REASONS = {
        TOO_MANY_WATCHINGS: '同時視聴中の番組が多すぎるため、番組を視聴できません',
        CROWDED: '満員のため、番組を視聴できませんでした',
        TEMPORARILY_CROWDED: '満員のため、番組を視聴できませんでした',
        NO_PERMISSION: 'この番組を視聴する権限がありません',
        USER_BANNED: 'ご利用のアカウントに問題があるため、番組を視聴することができませんでした',
    };

    /** @type {WebSocket | null} */
    let ws = null;
    /** @type {Hls | null} */
    let hls = null;
    let currentUri = '';
    let hasPlayed = false; // 一度でも再生できたか（以降の失敗は通常表示へ切り替えず再接続する）
    let stopped = false;   // 終了・視聴不可などで止めた状態（再読み込みボタンでのみ再開）
    let fellBack = false;
    let restarts = 0;
    let forcedMute = false; // 自動再生の制限で消音にしたか（クリックで元に戻す）
    let keepSeatTimer = 0;
    let startTimer = 0;
    let retryTimer = 0;
    let wpxb = ''; // コメント受信に付ける識別情報（公式プレイヤーと同じ形。番組情報から作る）
    /** @type {'window' | 'site'} 画質: 窓に合わせる / ニコ生の設定に合わせる（設定 liteQuality） */
    let qualityMode = 'window';

    // 画面は公式 HTML の解析が終わってから作る（init）
    /** @type {ReturnType<typeof buildUi>} */
    let ui;
    /** @type {HTMLVideoElement} */
    let video;
    /** @type {ReturnType<typeof createLiteCommentLayer>} */
    let comments;

    const ACTION_RELOAD = { label: '再読み込み', onClick: () => restart() };
    const ACTION_OFFICIAL = { label: '通常表示で開く', onClick: () => fallback('user') };
    const ACTION_CLOSE = { label: '閉じる', onClick: () => window.close() };

    // ===== 画面 =====

    // 公式ページの中身（スクリプトが動かないので骨組みだけ）を、最小限の自前の画面に差し替える
    function buildUi() {
        const video = document.createElement('video');
        video.id = 'lite_video';
        video.playsInline = true;
        video.autoplay = true; // hls.js がメディアエラーから復旧して映像を付け直したときも再生を続ける
        video.disableRemotePlayback = true; // Chrome が映像の左上に重ねるキャストボタンを出さない

        const overlay = document.createElement('div');
        overlay.id = 'lite_overlay';

        const unmute = document.createElement('button');
        unmute.id = 'lite_unmute';
        unmute.type = 'button';
        unmute.textContent = '🔇 クリックで音声ON';
        unmute.hidden = true;

        const controls = document.createElement('div');
        controls.id = 'lite_controls';
        controls.innerHTML = `
            <button type="button" class="lite_icon_btn" id="lite_mute" title="ミュート"></button>
            <input type="range" id="lite_volume" min="0" max="100" step="1" title="音量">
            <span class="lite_spacer"></span>
            <button type="button" class="lite_icon_btn" id="lite_comment_toggle" title="コメントを表示" aria-pressed="false">
                <svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 5v2h10V9H7zm0 4v2h7v-2H7z"/></svg>
            </button>
            <button type="button" class="lite_icon_btn" id="lite_reload" title="映像を再読み込み">
                <svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>`;

        document.body.replaceChildren(video, overlay, unmute, controls);

        const muteBtn = /** @type {HTMLButtonElement} */ (controls.querySelector('#lite_mute'));
        const volume = /** @type {HTMLInputElement} */ (controls.querySelector('#lite_volume'));
        const reloadBtn = /** @type {HTMLButtonElement} */ (controls.querySelector('#lite_reload'));
        const commentBtn = /** @type {HTMLButtonElement} */ (controls.querySelector('#lite_comment_toggle'));
        // この窓だけの切り替え（設定は変えない）
        commentBtn.addEventListener('click', () => setCommentsEnabled(!comments.enabled));

        muteBtn.addEventListener('click', () => {
            forcedMute = false;
            unmute.hidden = true;
            video.muted = !video.muted;
        });
        volume.addEventListener('input', () => {
            video.volume = Number(volume.value) / 100;
            if (video.muted && video.volume > 0) {
                forcedMute = false;
                unmute.hidden = true;
                video.muted = false;
            }
        });
        reloadBtn.addEventListener('click', () => restart());
        // 消音再生中は、画面のどこをクリックしても音声を戻す（クリックがユーザー操作になるので再生が許可される）
        unmute.addEventListener('click', restoreSound);
        video.addEventListener('click', restoreSound);
        video.addEventListener('dblclick', toggleFullscreen);
        video.addEventListener('volumechange', () => {
            updateVolumeUi();
            if (!forcedMute) saveVolume();
        });
        video.addEventListener('playing', onPlaying);

        return { video, overlay, unmute, muteBtn, volume, commentBtn };
    }

    /** @param {boolean} on */
    function setCommentsEnabled(on) {
        comments.setEnabled(on);
        ui.commentBtn.setAttribute('aria-pressed', String(on));
        ui.commentBtn.title = on ? 'コメントを隠す' : 'コメントを表示';
    }

    // コメントを流す時刻合わせに使う「映像の現在位置の時刻」。HLS の PROGRAM-DATE-TIME があればそれ、
    // なければ現在時刻からライブの遅れを引いた近似値
    function videoTime() {
        const date = hls && hls.playingDate;
        if (date) return date.getTime();
        const latency = hls ? hls.latency : NaN;
        return Date.now() - (Number.isFinite(latency) ? latency * 1000 : 0);
    }

    // 公式プレイヤーがコメント受信に付ける識別情報（WpXb）を同じ形で作る
    /** @param {any} props */
    function buildWpXb(props) {
        const payload = {
            userId: String((props.user && props.user.id) || ''),
            contentId: programId,
            frontendId: (props.site && props.site.frontendId) || 9,
            frontendVersion: String((props.site && props.site.frontendVersion) || ''),
            actionTrackId: `${Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')}_${Date.now()}`,
        };
        return btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // 読み込み中の表示。どの段階で止まっているか分かるよう、段階名も出す
    /** @param {string} stage */
    function showLoading(stage) {
        const spinner = document.createElement('div');
        spinner.className = 'lite_spinner';
        const label = document.createElement('div');
        label.className = 'lite_stage';
        label.textContent = stage;
        ui.overlay.replaceChildren(spinner, label);
        ui.overlay.hidden = false;
        console.info('別窓くん（軽量）:', stage);
    }

    /**
     * @param {string} text
     * @param {{ label: string, onClick: () => void }[]} actions
     */
    function showMessage(text, actions) {
        const p = document.createElement('div');
        p.textContent = text;
        const row = document.createElement('div');
        row.className = 'lite_actions';
        for (const a of actions) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'lite_action';
            b.textContent = a.label;
            b.addEventListener('click', a.onClick);
            row.appendChild(b);
        }
        ui.overlay.replaceChildren(p, row);
        ui.overlay.hidden = false;
    }

    function updateVolumeUi() {
        const muted = video.muted || video.volume === 0;
        ui.muteBtn.innerHTML = muted
            ? '<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
        ui.volume.value = String(Math.round(video.volume * 100));
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
        else document.documentElement.requestFullscreen().catch(() => { });
    }

    // ===== 音量（最後に使った値を次の窓の初期値にする。窓ごとの調整は独立） =====

    function applySavedVolume() {
        let volume = 0.5;
        let muted = false;
        try {
            const v = JSON.parse(localStorage.getItem(VOLUME_KEY) || 'null');
            if (v && typeof v.volume === 'number') volume = Math.min(1, Math.max(0, v.volume));
            if (v && typeof v.muted === 'boolean') muted = v.muted;
        } catch (e) { /* 読めなければ既定値 */ }
        video.volume = volume;
        video.muted = muted;
        updateVolumeUi();
    }

    function saveVolume() {
        try {
            localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: video.volume, muted: video.muted }));
        } catch (e) { /* プライベートモード等では保存しない */ }
    }

    function restoreSound() {
        if (!forcedMute) return;
        forcedMute = false;
        ui.unmute.hidden = true;
        video.muted = false;
        video.play().catch(() => { });
    }

    // ===== 視聴セッション =====

    let startGeneration = 0;

    /**
     * @param {any} [initialProps] 開いたときの HTML から読めた番組情報。無ければ（再接続時など）取得し直す
     */
    async function start(initialProps) {
        const generation = ++startGeneration; // 取得待ちの間に再読み込み等で start し直されたら古い方は捨てる
        stopped = false;
        showLoading('番組情報を取得中…');
        if (!hasPlayed) {
            clearTimeout(startTimer);
            startTimer = window.setTimeout(() => fallback('start timeout'), START_TIMEOUT_MS);
        }

        /** @type {any} */
        let props = initialProps;
        if (!props) {
            try {
                props = await fetchEmbeddedData();
            } catch (e) {
                if (generation === startGeneration) fail('embedded-data: ' + (e instanceof Error ? e.message : e));
                return;
            }
            if (generation !== startGeneration || stopped || fellBack) return;
        }

        const program = props.program || {};
        if (program.title) document.title = program.title;
        if (program.status !== 'ON_AIR') {
            // 開始前・終了後・タイムシフトは公式ページに任せる（再生中に終わった場合は終了表示）
            if (hasPlayed) showEnded();
            else fallback('status ' + program.status);
            return;
        }
        if (!props.userProgramWatch || !props.userProgramWatch.canWatch) {
            fallback('cannot watch'); // 会員限定・有料など。理由の表示は公式ページに任せる
            return;
        }
        const baseUrl = props.site && props.site.relive && props.site.relive.webSocketUrl;
        if (!baseUrl) {
            fallback('no webSocketUrl');
            return;
        }
        // 公式プレイヤーと同じく frontend_id を付ける（PCブラウザ = 9）
        const frontendId = (props.site && props.site.frontendId) || 9;
        wpxb = buildWpXb(props);
        showLoading('視聴サーバーに接続中…');
        connect(`${baseUrl}&frontend_id=${frontendId}`, false);
    }

    // 視聴ページの #embedded-data（番組情報・WebSocket URL）を読む
    /** @param {Document} doc */
    function readEmbeddedData(doc) {
        const raw = doc.getElementById('embedded-data')?.getAttribute('data-props');
        if (!raw) throw new Error('not found');
        return JSON.parse(raw);
    }

    // 再接続時は視聴トークンが古いので、視聴ページの HTML だけを取得し直して読む。
    // DOMParser で解析するだけなのでスクリプトは実行されない。
    async function fetchEmbeddedData() {
        const res = await fetch(WATCH_URL, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return readEmbeddedData(new DOMParser().parseFromString(await res.text(), 'text/html'));
    }

    /**
     * @param {string} url
     * @param {boolean} reconnect サーバーの再接続要求に応じた接続か（同じ視聴者として扱われる）
     */
    function connect(url, reconnect) {
        closeWebSocket();
        const sock = new WebSocket(url);
        ws = sock;
        sock.onopen = () => {
            // 公式プレイヤーと同じ形の視聴開始メッセージ（latency は lowLatencyMode:false に合わせて high）
            sock.send(JSON.stringify({
                type: 'startWatching',
                data: {
                    stream: { quality: requestedQuality(), protocol: 'hls', latency: 'high', accessRightMethod: 'single_cookie', chasePlay: false },
                    room: { protocol: 'webSocket', commentable: true },
                    reconnect,
                },
            }));
        };
        sock.onmessage = (ev) => {
            if (ws !== sock) return;
            /** @type {any} */
            let msg;
            try {
                msg = JSON.parse(ev.data);
            } catch (e) {
                return;
            }
            const data = (msg && msg.data) || {};
            switch (msg && msg.type) {
                case 'ping':
                    sock.send('{"type":"pong"}');
                    break;
                case 'seat':
                    startKeepSeat(sock, Number(data.keepIntervalSec) || 30);
                    break;
                case 'stream':
                    onStream(data);
                    break;
                case 'messageServer':
                    // コメントの配信元（コメント表示がオフなら接続はしない）
                    if (data.viewUri) comments.setServer(data.viewUri, data.vposBaseTime, wpxb);
                    break;
                case 'reconnect':
                    scheduleReconnect(url, data);
                    break;
                case 'disconnect':
                    onDisconnect(String(data.reason || ''));
                    break;
                case 'error':
                    fail('ws error: ' + (data.code || ''));
                    break;
            }
        };
        sock.onclose = () => {
            if (ws !== sock) return;
            ws = null;
            fail('ws closed');
        };
    }

    function closeWebSocket() {
        clearInterval(keepSeatTimer);
        keepSeatTimer = 0;
        const sock = ws;
        ws = null;
        if (!sock) return;
        sock.onopen = sock.onmessage = sock.onclose = null;
        try {
            sock.close();
        } catch (e) { /* 既に閉じている */ }
    }

    // 視聴を続けるため、サーバーが指定した間隔で keepSeat を送る
    /**
     * @param {WebSocket} sock
     * @param {number} intervalSec
     */
    function startKeepSeat(sock, intervalSec) {
        clearInterval(keepSeatTimer);
        keepSeatTimer = window.setInterval(() => {
            if (ws === sock && sock.readyState === WebSocket.OPEN) sock.send('{"type":"keepSeat"}');
        }, intervalSec * 1000);
    }

    // stream メッセージ: HLS の URL と CDN 用の署名 Cookie。
    // Cookie の更新だけで再送されることもあるので、URL が変わったときだけ再生し直す。
    /** @param {any} data */
    function onStream(data) {
        setCdnCookies(data.cookies);
        const uri = data.uri;
        if (!uri || uri === currentUri) return;
        currentUri = uri;
        playHls(uri);
    }

    // Cookie は番組ごとの path（/hls/playlists/<id>/… 等）が付いているので、多窓でも衝突しない
    /** @param {any} cookies */
    function setCdnCookies(cookies) {
        if (!Array.isArray(cookies)) return;
        for (const c of cookies) {
            if (!c || !c.name || c.value == null) continue;
            let str = `${c.name}=${c.value}`;
            if (c.domain) str += `; domain=${c.domain}`;
            if (c.path) str += `; path=${c.path}`;
            if (c.expires) str += `; expires=${new Date(c.expires).toUTCString()}`;
            if (c.maxAge != null) str += `; max-age=${c.maxAge}`;
            if (c.sameSite) str += `; samesite=${c.sameSite}`;
            if (c.secure !== false) str += '; secure';
            document.cookie = str;
        }
    }

    // サーバーからの再接続要求: 新しい audienceToken で指定時間後につなぎ直す（映像はその間も再生を続ける）
    /**
     * @param {string} url
     * @param {any} data
     */
    function scheduleReconnect(url, data) {
        const wait = Math.max(3000, (Number(data.waitTimeSec) || 0) * 1000 + Math.random() * 1000);
        clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
            const next = new URL(url);
            if (data.audienceToken) next.searchParams.set('audience_token', data.audienceToken);
            connect(next.toString(), true);
        }, wait);
    }

    /** @param {string} reason */
    function onDisconnect(reason) {
        if (reason === 'END_PROGRAM') {
            showEnded();
            return;
        }
        if (reason === 'TAKEOVER') {
            halt();
            showMessage('同じ番組が別の場所で開かれたため、この窓の視聴を終了しました', [ACTION_RELOAD, ACTION_CLOSE]);
            return;
        }
        if (!hasPlayed) {
            fallback('disconnect ' + reason); // 視聴できない理由の表示は公式ページに任せる
            return;
        }
        if (TERMINAL_REASONS[reason]) {
            halt();
            showMessage(TERMINAL_REASONS[reason], [ACTION_RELOAD, ACTION_OFFICIAL]);
            return;
        }
        fail('disconnect ' + reason);
    }

    // ===== 再生 =====

    /** @param {string} uri */
    function playHls(uri) {
        destroyHls();
        if (typeof Hls === 'undefined' || !Hls.isSupported()) {
            fallback('hls.js unavailable');
            return;
        }
        const h = new Hls(HLS_CONFIG);
        hls = h;
        let mediaRecovered = false;
        h.on(Hls.Events.MANIFEST_PARSED, () => {
            if (hls !== h) return;
            if (!hasPlayed) showLoading('映像を読み込み中…');
            // 上限を決め、最初からその画質で読み始める（低い画質から徐々に上がるのを待たない）
            const cap = capLevelToWindow();
            if (cap >= 0) h.startLevel = cap;
            h.startLoad(-1);
            tryPlay();
        });
        h.on(Hls.Events.ERROR, (_event, d) => {
            if (hls !== h || !d || !d.fatal) return; // 致命的でないエラーは hls.js が自分で再試行する
            if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
                mediaRecovered = true;
                h.recoverMediaError();
                return;
            }
            fail('hls ' + d.details);
        });
        h.loadSource(uri);
        h.attachMedia(video);
    }

    // 「窓に合わせる」: 窓の大きさに見合う解像度までに上限を設定し、その上限を返す（上限なしは -1）。
    // ・窓の長辺（画面の拡大率込み）を満たす最小の解像度を目標にし、その解像度以下でいちばんビットレートの
    //   高い段階まで使う（同じ解像度に複数のビットレートがある配信で、低い方に縛らないため）。
    // ・ただし MIN_LONG_SIDE（480p 相当）より下には下げない。
    // ・「ニコ生の設定に合わせる」では、サーバーがその画質だけのプレイリストを返すので上限は付けない。
    // ※ hls.js の capLevelToPlayerSize は、映像の割り当てがプレイリスト取得より先だと初回の判定が空振りするので使わない。
    function capLevelToWindow() {
        const h = hls;
        if (!h || h.levels.length < 2 || qualityMode === 'site') {
            if (h) h.autoLevelCapping = -1;
            return -1;
        }
        // 縦長配信もあるので長辺どうしで比べる。levels はビットレート昇順
        const sides = h.levels.map((l) => Math.max(l.width, l.height));
        const need = Math.max(Math.max(video.clientWidth, video.clientHeight) * (window.devicePixelRatio || 1), MIN_LONG_SIDE);
        const target = Math.min(...sides.filter((s) => s >= need)); // 窓より大きい段階がなければ Infinity＝上限なし
        let cap = -1;
        sides.forEach((s, i) => {
            if (s <= target) cap = i;
        });
        h.autoLevelCapping = cap === h.levels.length - 1 ? -1 : cap;
        return cap;
    }

    // 視聴開始時に要求する画質。「ニコ生の設定に合わせる」では公式プレイヤーで選んでいる画質を送る
    // （番組にない画質ならサーバーが近い画質に置き換える）。未設定・読めないときは自動（abr）
    function requestedQuality() {
        if (qualityMode !== 'site') return 'abr';
        try {
            const v = JSON.parse(localStorage.getItem(SITE_QUALITY_KEY) || 'null');
            if (typeof v === 'string' && /^[0-9a-z_.]+$/i.test(v)) return v;
        } catch (e) { /* 読めなければ自動 */ }
        return 'abr';
    }

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => { capLevelToWindow(); }, 300); // 窓の拡大・全画面で上限を上げ直す
    });

    function tryPlay() {
        video.play().catch((e) => {
            if (!e || e.name !== 'NotAllowedError' || video.muted) return;
            // 自動再生の制限で音声つき再生が拒否された → 消音で再生し、クリックで音声を戻す
            forcedMute = true;
            video.muted = true;
            ui.unmute.hidden = false;
            video.play().catch(() => { });
        });
    }

    function destroyHls() {
        const h = hls;
        hls = null;
        if (!h) return;
        try {
            h.destroy();
        } catch (e) { /* 破棄済み */ }
    }

    function onPlaying() {
        hasPlayed = true;
        restarts = 0;
        clearTimeout(startTimer);
        ui.overlay.hidden = true;
    }

    // 映像が進まなくなったら、視聴ページを取り直して最初からつなぎ直す
    let lastTime = -1;
    let lastProgressAt = Date.now();
    window.setInterval(() => {
        const now = Date.now();
        if (!video) return; // 画面を作る前
        if (!hasPlayed || stopped || video.paused || video.currentTime !== lastTime) {
            lastTime = video.currentTime;
            lastProgressAt = now;
            return;
        }
        if (now - lastProgressAt > STALL_TIMEOUT_MS) {
            lastProgressAt = now;
            fail('stalled');
        }
    }, 3000);

    // ===== 失敗時の扱い =====

    // 初回の再生前に失敗したら通常表示へ切り替える。再生中の失敗は回数を区切って自動でつなぎ直す。
    /** @param {string} reason */
    function fail(reason) {
        if (stopped || fellBack) return;
        if (!hasPlayed) {
            fallback(reason);
            return;
        }
        teardown();
        if (restarts >= MAX_RESTARTS) {
            stopped = true;
            showMessage('映像を受信できませんでした', [ACTION_RELOAD, ACTION_OFFICIAL]);
            return;
        }
        restarts++;
        console.info('別窓くん（軽量）: 再接続します', reason, restarts);
        showLoading(`再接続中…（${restarts}回目）`);
        retryTimer = window.setTimeout(start, Math.min(15000, 1000 * 2 ** (restarts - 1)));
    }

    function restart() {
        teardown();
        restarts = 0;
        start();
    }

    // 終了・視聴不可など、再読み込みボタンを押すまで再開しない状態にする
    function halt() {
        stopped = true;
        teardown();
    }

    function showEnded() {
        halt();
        showMessage('番組は終了しました', [ACTION_CLOSE]);
    }

    function teardown() {
        clearTimeout(retryTimer);
        clearTimeout(startTimer);
        closeWebSocket();
        destroyHls();
        currentUri = '';
        if (comments) comments.setServer(null);
    }

    // 従来のシンプル表示（公式プレイヤー）で開き直す
    /** @param {string} reason */
    function fallback(reason) {
        if (fellBack) return;
        fellBack = true;
        console.info('別窓くん（軽量）: 通常表示に切り替えます', reason);
        teardown();
        location.replace(simpleModeUrl());
    }

    function simpleModeUrl() {
        const next = new URL(location.href);
        next.searchParams.set('screenmode', '1');
        return next.toString();
    }

    // 公式のスクリプトが止まっているか（＝CSP が付いているか）を、ページにインラインスクリプトを入れて確かめる。
    // 付いていればブロックされて実行されない（コンソールに CSP 違反が出るのは想定どおり）。
    function officialScriptsBlocked() {
        const root = document.documentElement;
        const probe = document.createElement('script');
        probe.textContent = 'document.documentElement.dataset.betsumadoLiteProbe = "ran";';
        root.appendChild(probe);
        probe.remove();
        const ran = root.dataset.betsumadoLiteProbe === 'ran';
        delete root.dataset.betsumadoLiteProbe;
        return !ran;
    }

    // 窓を閉じる・シングルで別番組へ移るときは、席をすぐ空けるため視聴セッションを閉じる
    window.addEventListener('pagehide', halt);
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) restart(); // 戻る/進むキャッシュから復元されたときはつなぎ直す
    });

    // 公式 HTML の解析が終わったら（スクリプトは CSP で動かない）、番組情報を読んでから画面を差し替える
    function init() {
        /** @type {any} */
        let props = null;
        try {
            props = readEmbeddedData(document);
        } catch (e) { /* 読めなければ start() が取得し直す */ }
        ui = buildUi();
        video = ui.video;
        comments = createLiteCommentLayer(video, videoTime);
        document.title = (props && props.program && props.program.title) || programId;
        applySavedVolume();

        // 設定（画質・コメント）を読んでから視聴を始める。読めなくても既定値で始める
        chrome.storage.local.get(['liteQuality', 'liteComments'])
            .then((v) => {
                qualityMode = v.liteQuality === 'site' ? 'site' : 'window';
                setCommentsEnabled(v.liteComments === true);
            })
            .catch(() => { })
            .finally(() => start(props));

        // 設定画面で変えたら、開いている窓にもすぐ反映する（画質は視聴し直す）
        chrome.storage.onChanged.addListener((changes) => {
            if (changes.liteComments) setCommentsEnabled(changes.liteComments.newValue === true);
            if (changes.liteQuality) {
                const next = changes.liteQuality.newValue === 'site' ? 'site' : 'window';
                if (next !== qualityMode) {
                    qualityMode = next;
                    if (!stopped && !fellBack) restart();
                }
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
