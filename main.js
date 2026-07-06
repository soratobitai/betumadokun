// @ts-check

/**
 * 拡張の設定値
 * @typedef {Object} Options
 * @property {string} windowmode  別窓モード '1'=シングル / '2'=多窓 / '3'=タブ
 * @property {string} screenmode  映像モード '1'=シンプル / '2'=多機能
 * @property {number|string} window_w  別窓の幅(px)。既定は数値、フォーム入力経由では文字列
 * @property {number|string} window_h  別窓の高さ(px)。既定は数値、フォーム入力経由では文字列
 * @property {boolean} alwaysOnTop  別窓を常に手前に表示するか
 */

/** @type {Options} */
let defaultOptions = {
    windowmode: '2',
    screenmode: '1',
    window_w: 500,
    window_h: 281,
    alwaysOnTop: false,
};
let options = /** @type {Options} */ ({});
const linkIconURL = chrome.runtime.getURL('images/link.png');
const linkButton = `<div class="nicolive_link_button_wrap"><div class="nicolive_link_button"><img src="${linkIconURL}"></div></div>`;
const settingsButton = `<div class="nicolive_settings_button_wrap"><div class="nicolive_settings_button">⚙</div></div>`;

/** @type {Window[]} */
let openedWindows = [];
let windowPositionOffset = 30;

// Shadow DOM 内へ注入する main.css のテキスト（起動時に先読みしてキャッシュ）
let mainCssText = '';

/**
 * ブラウザがアイドル状態になったときに処理を実行する
 * 古いブラウザ向けに fallback として setTimeout を使用
 * @param {() => void} callback - 実行したい処理
 * @param {number} fallbackDelay - fallback 時の遅延ミリ秒（デフォルト2000ms）
 */
function runWhenIdle(callback, fallbackDelay = 2000) {
    if ('requestIdleCallback' in window) {
        requestIdleCallback(callback, { timeout: fallbackDelay });
    } else {
        setTimeout(callback, fallbackDelay);
    }
}

// ===== 番組サムネの検出 & ボタン注入 =====
// ・live（ライトDOMの <a><img>）はホバー起点＋直親<a>の軽量判定（下部 runWhenIdle 内で登録）。
//   SPA の常時 DOM 変化に反応しないため軽い。
// ・blog は番組ウィジェットが Shadow DOM 内でオーバーレイに覆われ、ホバーでは img/リンクに
//   届かないため、open Shadow を貫通して能動走査する。表示は CSS の :hover。
//   継続コストを抑えるため、MutationObserver は「追加ノードのみ」走査し、全再走査はしない。

/** @type {WeakSet<Node>} */
const observedRoots = new WeakSet();
/** @type {WeakSet<Element>} 遅延再走査を予約済みのカスタム要素（重複予約を防ぐ） */
const upgradeWatched = new WeakSet();

// node（root もしくは追加されたサブツリー）を走査して対象IMGにボタンを注入する。
// 見つけた open Shadow root は監視登録して再帰する（後から描画される img も拾えるように）。
/** @param {ParentNode} node */
function scanForButtons(node) {
    // 追加ノード自身が IMG のこともある
    if (node instanceof Element && node.tagName === 'IMG' && isTargetImage(node)) {
        insertPopupButton(node);
    }
    let all;
    try {
        all = node.querySelectorAll('*');
    } catch (e) {
        return;
    }
    all.forEach((el) => {
        if (el.tagName === 'IMG' && isTargetImage(el)) insertPopupButton(el);
        if (el.shadowRoot) {
            observeRoot(el.shadowRoot); // ウィジェットの Shadow を監視（後からの img 描画も拾う）
            scanForButtons(el.shadowRoot);
        } else if (el.tagName.includes('-') && !upgradeWatched.has(el)) {
            // Shadow 未アタッチのカスタム要素（例: <nico-audition-*>）。アップグレードで Shadow が
            // 遅れて付く場合に取りこぼさないよう、一度だけ遅延再走査する（全再走査は避ける）。
            upgradeWatched.add(el);
            setTimeout(() => scanForButtons(el), 800);
        }
    });
}

// Document/ShadowRoot を監視する（root ごとに一度だけ）。
// 全再走査はせず、追加されたノードのサブツリーだけを走査する＝継続コストを抑える。
/** @param {Document | ShadowRoot} root */
function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    new MutationObserver((mutations) => {
        for (const m of mutations) {
            m.addedNodes.forEach((n) => {
                if (n instanceof Element) scanForButtons(n);
            });
        }
    }).observe(root, { childList: true, subtree: true });
}

runWhenIdle(async () => {
    // オプションを取得
    options = await getOptions();

    // ページ移動前に開いていた別窓を名前で取り直し、追跡・「常に手前」監視を再確立する
    reacquirePopups();

    // 「常に手前」有効時は、別窓の有無に関わらず親ページ操作の監視を開始しておく。
    // 前面化は SW が chrome.windows.getAll で別窓を特定して行うため、本ページが別窓を
    // 追跡していなくても（例：別番組へ移動した直後）親ページ操作で前面化を依頼できる。
    if (options.alwaysOnTop) startAlwaysOnTopMonitoring();

    // Shadow DOM 内にボタンを表示するため、注入用に main.css を先読みしておく
    fetch(chrome.runtime.getURL('main.css')).then(r => r.text()).then(t => { mainCssText = t; }).catch(() => { });

    // 番組サムネにボタンを注入する（ページ種別で方式を分ける）。
    // 対象判定は共通で柔軟（最寄り祖先<a>）＋小さすぎるサムネは insertPopupButton がサイズで除外。
    if (location.hostname === 'blog.nicovideo.jp') {
        // blog: Shadow DOM ウィジェット対応のため能動走査。初回＋時限走査で初期表示分を拾い、
        // 以後は observeRoot が「追加ノードのみ」観測する（全再走査しないので継続コストが軽い）。
        observeRoot(document);
        scanForButtons(document);
        setTimeout(() => scanForButtons(document), 1500);
        setTimeout(() => scanForButtons(document), 4000);
    } else {
        // live/www 等: ホバー起点で対象サムネにだけ注入（SPA の常時 DOM 変化に反応せず軽い）。
        document.addEventListener('mouseover', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            // 通常サムネ（<img> 起点）
            const img = target.closest('img');
            if (img && isTargetImage(img)) { insertPopupButton(img); return; }
            // 背景画像サムネ（<img> を持たない watch/lv リンク。例: www の /my タイムライン）
            const anchor = /** @type {HTMLAnchorElement|null} */ (target.closest('a'));
            if (anchor && !anchor.querySelector('img') && resolveWatchUrl(anchor) !== null) {
                insertPopupButtonForLink(anchor);
            }
        });
    }
})


/**
 * アンカーから視聴ページURL（https://live.nicovideo.jp/watch/lvXXXX）を解決する。
 * ・通常サムネ: href に watch/lv を含む → その href をそのまま返す
 * ・ニコニ広告サムネ: href は広告リダイレクト(api.nicoad...)で番組IDを含まないため、
 *   祖先の <article id="lvXXXX"> から番組IDを取り出して視聴URLを組み立てる
 *   （リダイレクトを追跡しないので、かつて「対応不可」だった CORS 制限の影響を受けない）
 * 解決できなければ null。
 * @param {HTMLAnchorElement} anchorElement
 * @returns {string|null}
 */
function resolveWatchUrl(anchorElement) {
    const href = anchorElement.href || '';
    if (href.includes('live.nicovideo.jp/watch/lv')) return href;

    // ニコニ広告サムネ（href が広告リダイレクト）のときだけ、祖先の <article id="lvXXXX">
    // から番組IDを取り出して視聴URLを組み立てる。
    // ※ 広告リンクに限定＋<article> の lv 数値idに限定することで、同じカード内の別リンク画像や
    //   ライブ以外の広告（動画/静画/コミュニティ）を誤って対象化しない
    if (href.includes('api.nicoad.nicovideo.jp')) {
        const idEl = anchorElement.closest('article[id^="lv"]');
        if (idEl && /^lv\d+$/.test(idEl.id)) {
            return `https://live.nicovideo.jp/watch/${idEl.id}`;
        }
    }
    return null;
}

// サムネが小さすぎるとボタン(右上・約30px)で画像が隠れてしまうため、実寸がこれ未満の
// サムネにはボタンを付けない。値はチューニング可能（16:9 の小サムネ ~64x36 を除外し、
// ~96x54 以上を許可する目安）。
const MIN_THUMB_W = 80;
const MIN_THUMB_H = 45;
/** @type {WeakSet<Element>} 小さすぎて対象外と判定した画像（毎ホバーの再測定を避ける） */
const tooSmallImages = new WeakSet();
/** @type {WeakSet<Element>} 背景画像サムネのリンクで処理済み（毎ホバーの再走査を避ける） */
const processedLinks = new WeakSet();

/**
 * 画像がニコ生番組リンク配下の対象画像か判定する（通常サムネ＋ニコニ広告サムネ）
 * ※ 構造（直親/ネスト）では絞らず柔軟に検出する。小さすぎるサムネの除外は
 *   insertPopupButton 側のサイズ判定で行う。
 * @param {Element} imageElement
 * @returns {boolean}
 */
function isTargetImage(imageElement) {
    // 自前で注入したボタンのアイコン画像(link.png)は対象外。
    // これを弾かないと、番組<a>配下にある自分のアイコンを再検出して入れ子注入が無限に続く
    if (imageElement.closest('.nicolive_link_button_wrap')) return false;

    // 画像を包む最寄りのリンク(<a>)を取得（live/blog/www いずれも間に <div> 等が挟まりうる）
    const anchorElement = /** @type {HTMLAnchorElement} */ (imageElement.closest('a'));
    if (!anchorElement || !anchorElement.href) return false;

    // 視聴ページURLを解決できるものだけ対象にする
    return resolveWatchUrl(anchorElement) !== null;
}

/**
 * サムネイル画像に別窓ボタン・設定ボタンを挿入する
 * @param {Element} imageElement
 */
async function insertPopupButton(imageElement) {
    if (!isTargetImage(imageElement)) return;

    // URL解決は最寄りの <a>、ボタンの挿入・配置は画像の入れ物（直親）を基準にする。
    // live は入れ物＝<a> のことが多いが、blog/www は <a><div><img>… のように間に要素が挟まる
    const anchorElement = /** @type {HTMLAnchorElement} */ (imageElement.closest('a'));
    const containerElement = /** @type {HTMLElement} */ (imageElement.parentElement);
    if (!anchorElement || !containerElement) return;

    // ボタンが既にある場合はスルー（画像の入れ物単位で判定）
    if (containerElement.querySelector('.nicolive_link_button_wrap')) return;

    // サムネが小さすぎるとボタンで画像が隠れてしまうので付けない（実寸で判定）。
    // 未レイアウト等でサイズ0のときは判定を保留＝許可する（誤って隠さないため）。
    if (tooSmallImages.has(imageElement)) return;
    const rect = imageElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && (rect.width < MIN_THUMB_W || rect.height < MIN_THUMB_H)) {
        tooSmallImages.add(imageElement);
        return;
    }

    // Shadow DOM 内なら、その root に main.css を注入（ライトDOMは content_scripts で適用済み）
    ensureStylesInRoot(containerElement.getRootNode());

    // CSS の :hover でボタンを表示するための印（カード全体＝アンカーに付ける）
    anchorElement.classList.add('nicolive_thumb_host');

    // 画像の直後（＝入れ物の中）に挿入（別窓ボタンと設定ボタン）
    imageElement.insertAdjacentHTML('afterend', linkButton + settingsButton);

    // 配置（既定＝右上／右上が埋まっていれば右辺中央）は、カードが実際に表示された時点で判定する。
    // 能動スキャン時点では画面外のカードが多く、その場で判定すると誤って中央になってしまうため。
    placementObserver.observe(containerElement);

    // 入れ物を relative に（ボタンの絶対配置基準）
    if (!containerElement.style.position) {
        containerElement.style.position = 'relative';
        containerElement.style.overflow = 'visible';
    }

    // クリックイベントなど追加（URLはアンカー、ボタン走査・ホバーは入れ物）
    addActions(anchorElement, containerElement);
}

/**
 * <img> を持たないリンク内で、背景画像(background-image)のサムネ枠要素を返す（無ければ null）。
 * 重なり合うレイヤ構造（背景ぼかし＋前面サムネ）に備え、最大の背景画像要素から同サイズの
 * 祖先まで遡って「枠」を容器として返す（ボタンがレイヤに隠れないように）。
 * @param {HTMLAnchorElement} anchorElement
 * @returns {HTMLElement|null}
 */
function findThumbnailBox(anchorElement) {
    /** @type {HTMLElement|null} */
    let best = null;
    let bestArea = 0;
    anchorElement.querySelectorAll('*').forEach((el) => {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none' || bg.indexOf('url') === -1) return;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = /** @type {HTMLElement} */ (el); }
    });
    if (!best) return null;

    // best と同サイズの祖先（＝サムネ枠）まで遡る。枠を容器にするとレイヤの上にボタンを置ける。
    const br = best.getBoundingClientRect();
    let box = best;
    for (let p = best.parentElement; p && p !== anchorElement; p = p.parentElement) {
        const pr = p.getBoundingClientRect();
        if (Math.abs(pr.width - br.width) <= 4 && Math.abs(pr.height - br.height) <= 4) {
            box = /** @type {HTMLElement} */ (p);
        } else {
            break;
        }
    }
    return box;
}

/**
 * <img> を持たない watch/lv リンク（背景画像サムネ。例: www の /my タイムライン）に
 * 別窓ボタン・設定ボタンを付ける。サムネ枠を容器にし、サイズ足切りも枠で判定する。
 * @param {HTMLAnchorElement} anchorElement
 */
function insertPopupButtonForLink(anchorElement) {
    if (processedLinks.has(anchorElement)) return;
    if (anchorElement.querySelector('.nicolive_link_button_wrap')) return;

    const box = findThumbnailBox(anchorElement);
    if (!box) { processedLinks.add(anchorElement); return; } // サムネ枠が無い（テキストのみ等）→対象外

    // 小さすぎるサムネはボタンで隠れるので付けない（枠の実寸で判定）
    const rect = box.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && (rect.width < MIN_THUMB_W || rect.height < MIN_THUMB_H)) {
        processedLinks.add(anchorElement);
        return;
    }
    processedLinks.add(anchorElement);

    ensureStylesInRoot(box.getRootNode());
    anchorElement.classList.add('nicolive_thumb_host'); // CSS の :hover 表示用の印
    box.insertAdjacentHTML('beforeend', linkButton + settingsButton);
    placementObserver.observe(box);
    // 枠を絶対配置の基準に（静的配置のときだけ relative にして既存レイアウトを壊さない）
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    addActions(anchorElement, box);
}

/**
 * ボタン設置予定地（rectEl の右上・約17px内側）が、カード(cardEl)の「外」の要素で
 * 覆われているか判定する。カード内の要素（番組画像・透明な操作用オーバーレイ・自前ボタン等）は
 * 重なりに含めない（それらで誤って中央退避しないため）。覆われていれば右辺中央へ退避する。
 * 判定できないとき（未レイアウト/画面外/取得不能）は false（＝既定位置の右上のまま）。
 * 中央退避は「カード外の要素（＝ニコ生のタイムシフト予約ボタン等）が右上に重なっている」と
 * 確認できたときだけ行う。
 * @param {Element} rectEl 位置の基準（別窓ボタンが置かれる入れ物）
 * @param {Element} cardEl カード全体（番組リンク <a>）
 * @returns {boolean}
 */
function isTopRightOccupied(rectEl, cardEl) {
    const rect = rectEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // 別窓ボタン（右上・約30px四方）の中心付近を調べる
    const x = rect.right - 17;
    const y = rect.top + 17;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;

    // Shadow DOM 内では document ではなく所属 root(ShadowRoot) の elementFromPoint を使う
    const root = rectEl.getRootNode();
    const topEl = (root instanceof ShadowRoot ? root : document).elementFromPoint(x, y);
    if (!topEl) return false;

    // カード内の要素や、カードの祖先コンテナ ＝ 重なりではない
    if (cardEl.contains(topEl)) return false;
    if (topEl.contains(cardEl)) return false;

    // カード外の別要素が右上に重なっている（＝ニコ生のタイムシフト予約ボタン等）
    return true;
}

// カードが実際に表示された時点で右上/中央の配置を判定する。
// 能動スキャン時点では未レイアウト/画面外のカードが多く、その場で判定すると
// 右上が空いていても中央になってしまうため、可視化を待ってから判定する。
const placementObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        placementObserver.unobserve(entry.target);
        const container = /** @type {HTMLElement} */ (entry.target);
        const card = container.closest('a');
        const wrap = /** @type {HTMLElement} */ (container.querySelector('.nicolive_link_button_wrap'));
        if (wrap && card && isTopRightOccupied(container, card)) {
            wrap.classList.add('nicolive_link_button_wrap_center');
        }
    });
}, { threshold: 0.5 });

/** @type {WeakSet<ShadowRoot>} */
const styledShadowRoots = new WeakSet();

/**
 * Shadow DOM 内にボタンを表示するため、その ShadowRoot に main.css を注入する（root ごとに一度）。
 * ライトDOM(document)は content_scripts で既に適用済みなので何もしない。
 * @param {Node} rootNode  containerElement.getRootNode() の戻り値
 */
function ensureStylesInRoot(rootNode) {
    if (!(rootNode instanceof ShadowRoot) || styledShadowRoots.has(rootNode)) return;
    styledShadowRoots.add(rootNode);

    if (mainCssText) {
        // 先読み済みならテキストを同期注入（チラつきなし）
        const style = document.createElement('style');
        style.textContent = mainCssText;
        rootNode.appendChild(style);
    } else {
        // 先読み未完了時のフォールバック（非同期ロード）
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL('main.css');
        rootNode.appendChild(link);
    }
}

function focusOpenedWindows() {
    // 「常に手前に表示」が有効な場合は、前面化を拡張の Service Worker (chrome.windows API) に
    // 委譲する。Web の window.focus() は複数の別窓を同時に手前へ保てず（OSのアクティブ窓は1つ）、
    // 本ページ移動後に再取得した別窓は上げにくいため、opener 関係・ユーザー操作の有無に
    // 依存しない SW 経由の前面化に一本化している。別窓の特定は SW 側で chrome.windows.getAll
    // の URL 照合により行うため、この追跡配列(openedWindows)の状態には依存しない。
    if (options.alwaysOnTop) {
        try {
            chrome.runtime.sendMessage({ type: 'RAISE_POPUPS' }, () => { void chrome.runtime.lastError; });
        } catch (e) { /* 拡張コンテキスト無効時は無視 */ }
        return;
    }

    // 通常の動作（多窓機能）: すべての別窓を順番にフォーカス
    openedWindows.forEach(function (win) {
        try {
            win.focus();
        } catch (e) {
            // エラーを無視
        }
    });
}

// 別窓からアクセスできるようにグローバルに公開
window.focusOpenedWindows = focusOpenedWindows;

// 常に手前に表示する設定
/** @type {{ type: string, handler: EventListener }[]} */
let alwaysOnTopEventHandlers = [];

let lastRaiseTime = 0;

function startAlwaysOnTopMonitoring() {
    if (alwaysOnTopEventHandlers.length > 0) return; // 既に開始済み

    // 親ページを操作したら別窓群を前面へ戻す。
    // ・監視は mousedown のみ（旧: mousedown/click/focus）。focus 起点の再フォーカスは
    //   フォーカス争奪・ループ・親ページ操作不能の主因で、gesture 裏付けも弱く focus() が通りにくい。
    //   mousedown はユーザー操作(gesture)内で同期実行でき focus() が通りやすく、余計な再フォーカスも減る。
    // ・leading-edge スロットルで連続操作時の focus() storm を防ぐ（同期のまま＝gesture を維持）。
    const handler = () => {
        if (!options.alwaysOnTop) return;
        const now = Date.now();
        if (now - lastRaiseTime < 150) return;
        lastRaiseTime = now;
        focusOpenedWindows();
    };

    window.addEventListener('mousedown', handler, true);
    alwaysOnTopEventHandlers.push({ type: 'mousedown', handler });
}

function stopAlwaysOnTopMonitoring() {
    alwaysOnTopEventHandlers.forEach(({ type, handler }) => {
        window.removeEventListener(type, handler, true);
    });
    alwaysOnTopEventHandlers = [];
}

// ===== 別窓の永続化 & ページ移動後の再接続 =====
// 別窓の追跡は本ページ(opener)のメモリに持つため、本ページを別番組へ移動すると失われる
// （別窓自体は生きているのに手前表示や追跡が切れる）。そこで開いている別窓の「名前」を
// sessionStorage（同一タブでページ移動をまたいで残る）に保存し、移動後の新ページ起動時に
// window.open('', name) で参照を取り直して追跡・監視を再確立する。

const SESSION_KEY = 'betsumado_open_windows';

/** @returns {string[]} 開いている別窓の名前一覧 */
function sessionGetNames() {
    try {
        const v = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]');
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

/** @param {string[]} names */
function sessionSetNames(names) {
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(names));
    } catch (e) { /* プライベートモード等では無視 */ }
}

/** @param {string} name */
function sessionAddName(name) {
    const names = sessionGetNames();
    if (!names.includes(name)) {
        names.push(name);
        sessionSetNames(names);
    }
}

/** @param {string} name */
function sessionRemoveName(name) {
    sessionSetNames(sessionGetNames().filter(n => n !== name));
}

// 多窓用の一意な別窓名（sessionStorage 連番でページ移動後も衝突しない）
/** @returns {string} */
function makePopupName() {
    let seq = 0;
    try {
        seq = parseInt(sessionStorage.getItem('betsumado_seq') || '0', 10) || 0;
    } catch (e) { /* ignore */ }
    seq += 1;
    try {
        sessionStorage.setItem('betsumado_seq', String(seq));
    } catch (e) { /* ignore */ }
    return 'betsumado_' + seq;
}

// ページ移動後、既存の別窓を名前で取り直して追跡・監視を再確立する（常に手前が有効な時のみ）
function reacquirePopups() {
    if (!options.alwaysOnTop) return; // この機能は「常に手前」用途。通常多窓は再接続しない
    const names = sessionGetNames();
    if (names.length === 0) return;

    /** @type {string[]} */
    const stillOpen = [];
    for (const name of names) {
        /** @type {Window | null} */
        let win = null;
        try {
            win = window.open('', name); // 既存の名前付き窓なら参照を返す（無ければ空白窓を開いてしまう）
        } catch (e) {
            win = null;
        }
        if (!win) continue;

        let valid = false;
        try {
            if (!win.closed && win.location.href.indexOf('nicovideo.jp/watch/') !== -1) valid = true;
        } catch (e) {
            valid = false;
        }

        if (valid) {
            // 既にクリック経路で追跡済みなら二重追跡しない
            if (!openedWindows.includes(win)) trackOpenedWindow(win, name);
            stillOpen.push(name);
        } else {
            // 我々の別窓ではない（誤って開いた空白窓など）→ 閉じてリストから除外
            try {
                if (!win.closed && win.location.href === 'about:blank') win.close();
            } catch (e) { /* ignore */ }
        }
    }
    sessionSetNames(stillOpen);

    if (openedWindows.length > 0) startAlwaysOnTopMonitoring();
}

// 別窓を追跡リストに追加し、フォーカス/クローズ（unload）を監視する
// シングル・多窓で共通のトラッキング処理
/**
 * @param {Window} win
 * @param {string} name window.open で付けた別窓名（sessionStorage 上の識別子）
 */
function trackOpenedWindow(win, name) {
    openedWindows.push(win);

    win.addEventListener('unload', () => {
        // unload は「実際に閉じた時」だけでなく「別番組へ再ナビゲートした時（単窓の再利用や
        // 初回 about:blank→URL）」にも発火する。少し待って win.closed を確認し、本当に閉じた
        // ときだけ追跡から外す（再ナビゲーションでは閉じていないので維持する）。
        setTimeout(() => {
            try {
                if (!win.closed) return; // まだ開いている＝再ナビゲーション
            } catch (e) {
                return; // 判定不能なら維持
            }
            openedWindows = openedWindows.filter(win_ => win_ !== win);
            sessionRemoveName(name); // 永続リストからも削除

            if (openedWindows.length === 0 && options.alwaysOnTop) {
                stopAlwaysOnTopMonitoring();
            }
        }, 200);
    });
}

/**
 * @param {HTMLAnchorElement} anchorElement 視聴URLの解決元（最寄りの <a>）
 * @param {HTMLElement} containerElement ボタンが挿入された画像の入れ物
 */
function addActions(anchorElement, containerElement) {

    // 広告サムネは href が広告リダイレクトなので、視聴ページURLへ解決してから使う
    const liveUrl = resolveWatchUrl(anchorElement) || anchorElement.href;
    const nicolive_link_button = containerElement.querySelector('.nicolive_link_button');
    const nicolive_settings_button = containerElement.querySelector('.nicolive_settings_button');

    nicolive_link_button.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        focusOpenedWindows();

        // シングル（常に同じ名前の窓を再利用）
        if (options.windowmode === '1') {
            const name = 'betsumado_single';
            const win = window.open(`${liveUrl}?&popup=on&screenmode=${options.screenmode}`, name, `width=${options.window_w},height=${options.window_h},resizable=yes,location=no,toolbar=no,menubar=no`);

            // 閉じられたウィンドウを配列から削除
            openedWindows = openedWindows.filter(w => {
                try {
                    return !w.closed;
                } catch (e) {
                    return false;
                }
            });

            if (win && !openedWindows.includes(win)) {
                // 初回（または閉じた後）→ 追跡開始
                sessionAddName(name);
                trackOpenedWindow(win, name);
            }
            // 既存の単窓を再利用する場合は追加処理不要（前面化は SW が担う）
        }
        // 多窓（毎回新しい名前で開く）
        if (options.windowmode === '2') {
            const position = openedWindows.length * windowPositionOffset;
            const name = makePopupName();
            const win = window.open(`${liveUrl}?&popup=on&screenmode=${options.screenmode}`, name, `width=${options.window_w},height=${options.window_h},top=${position},left=${position},resizable=yes,location=no,toolbar=no,menubar=no`);

            if (win) {
                sessionAddName(name);
                trackOpenedWindow(win, name);
            }
        }
        // タブ
        if (options.windowmode === '3') {
            window.open(`${liveUrl}`);
        }
        
        // alwaysOnTopが有効な場合、モニタリングを開始
        if (options.alwaysOnTop && options.windowmode !== '3') {
            startAlwaysOnTopMonitoring();
        }

    }, false);

    // 設定ボタンのクリックイベント
    nicolive_settings_button.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openSettingsModal();
    }, false);

    // ボタンの表示は CSS の :hover（.nicolive_thumb_host:hover）で行うため、JS でのクラス付与は不要
}



// 設定が変更されたら更新する
chrome.storage.onChanged.addListener(function (changes) {
    if (changes.windowmode) options.windowmode = changes.windowmode.newValue;
    if (changes.screenmode) options.screenmode = changes.screenmode.newValue;
    if (changes.window_w) options.window_w = changes.window_w.newValue;
    if (changes.window_h) options.window_h = changes.window_h.newValue;
    if (changes.alwaysOnTop) {
        options.alwaysOnTop = changes.alwaysOnTop.newValue;
        // オプションの変更に応じてモニタリングを開始/停止
        if (options.alwaysOnTop && openedWindows.length > 0) {
            startAlwaysOnTopMonitoring();
        } else if (!options.alwaysOnTop) {
            stopAlwaysOnTopMonitoring();
        }
    }
});

// オプションを取得（保存値で既定値を上書きして返す）
/** @returns {Promise<Options>} */
const getOptions = async () => {
    const stored = await chrome.storage.local.get();
    return /** @type {Options} */ ({ ...defaultOptions, ...stored });
};

// 設定モーダルを開く
function openSettingsModal() {
    // 既にモーダルが存在する場合は削除
    const existingModal = document.getElementById('nicolive_settings_modal');
    if (existingModal) {
        existingModal.remove();
    }

    // モーダルを作成
    const modalHTML = `
        <div id="nicolive_settings_modal" class="nicolive_modal">
            <div class="nicolive_modal_content">
                <div class="nicolive_modal_header">
                    <h2>別窓くん設定</h2>
                    <span class="nicolive_modal_close">&times;</span>
                </div>
                <div class="nicolive_modal_body">
                    <form id="nicolive_settings_form">
                        <div class="nicolive_modal_section">
                            <h3>別窓モード</h3>
                            <div class="nicolive_option_item">
                                <label>
                                    <input type="radio" name="windowmode" value="1">
                                    <span class="nicolive_label_text">シングル</span>
                                </label>
                                <p class="nicolive_option_desc">ウィンドウは常に１つで、新しく開かれた番組は常にこのウィンドウに表示されます。</p>
                            </div>
                            <div class="nicolive_option_item">
                                <label>
                                    <input type="radio" name="windowmode" value="2">
                                    <span class="nicolive_label_text">多窓</span>
                                </label>
                                <p class="nicolive_option_desc">常に新しいウィンドウで番組が開かれます。</p>
                            </div>
                            <div class="nicolive_option_item">
                                <label>
                                    <input type="radio" name="windowmode" value="3">
                                    <span class="nicolive_label_text">タブ</span>
                                </label>
                                <p class="nicolive_option_desc">新しいタブで番組が開かれます。（別ウィンドウは開かれません）</p>
                            </div>
                        </div>

                        <div class="nicolive_modal_section">
                            <h3>映像モード</h3>
                            <p class="nicolive_section_desc">別窓で開かれた番組の表示方法を指定します。（タブ表示の場合は適応されません）</p>
                            <div class="nicolive_option_item">
                                <label>
                                    <input type="radio" name="screenmode" value="1">
                                    <span class="nicolive_label_text">シンプル</span>
                                </label>
                                <p class="nicolive_option_desc">ライブ映像のみのシンプルな表示。コメントはできません。</p>
                            </div>
                            <div class="nicolive_option_item">
                                <label>
                                    <input type="radio" name="screenmode" value="2">
                                    <span class="nicolive_label_text">多機能</span>
                                </label>
                                <p class="nicolive_option_desc">
                                    コメントやニコ生の標準機能が利用できます。<br>
                                    <strong>ニコ生の画面設定「フルスクリーンサイズ」を「ブラウザサイズ」に設定してください。</strong>
                                    「モニタサイズ」設定の場合は別窓になりません。
                                </p>
                            </div>
                        </div>

                        <div class="nicolive_modal_section">
                            <h3>別窓サイズ</h3>
                            <p class="nicolive_section_desc">別窓ウィンドウのサイズを指定できます。</p>
                            <div class="nicolive_size_inputs">
                                <div class="nicolive_size_input_row">
                                    <label>幅</label>
                                    <input type="text" name="window_w" class="nicolive_size_input">
                                </div>
                                <div class="nicolive_size_input_row">
                                    <label>高さ</label>
                                    <input type="text" name="window_h" class="nicolive_size_input">
                                    <button type="button" id="nicolive_aspect_button">アスペクト比16:9に設定</button>
                                </div>
                            </div>
                        </div>

                        <div class="nicolive_modal_section">
                            <h3>表示オプション</h3>
                            <div class="nicolive_checkbox_item">
                                <label>
                                    <input type="checkbox" name="alwaysOnTop">
                                    <span class="nicolive_label_text">別窓を常に手前に表示</span>
                                </label>
                                <p class="nicolive_option_desc">元のページをクリックしても、別窓が常に前面に表示されます。</p>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // モーダルの初期値を設定
    initializeModalValues();

    // イベントリスナーを追加
    addModalEventListeners();
}

// セレクタで input 要素を型付き取得するヘルパー
/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
const qInput = (root, selector) => /** @type {HTMLInputElement} */ (root.querySelector(selector));

// モーダルの初期値を設定
function initializeModalValues() {
    // 別窓モード
    document.querySelectorAll('input[name="windowmode"]').forEach(input => {
        const el = /** @type {HTMLInputElement} */ (input);
        el.checked = el.value === options.windowmode;
    });

    // 映像モード
    document.querySelectorAll('input[name="screenmode"]').forEach(input => {
        const el = /** @type {HTMLInputElement} */ (input);
        el.checked = el.value === options.screenmode;
    });

    // 別窓サイズ
    qInput(document, 'input[name="window_w"]').value = String(options.window_w);
    qInput(document, 'input[name="window_h"]').value = String(options.window_h);

    // 表示オプション
    qInput(document, 'input[name="alwaysOnTop"]').checked = options.alwaysOnTop;
}

// モーダルのイベントリスナーを追加
function addModalEventListeners() {
    const modal = document.getElementById('nicolive_settings_modal');
    const closeBtn = modal.querySelector('.nicolive_modal_close');

    // 閉じるボタン
    closeBtn.addEventListener('click', () => {
        modal.remove();
    });

    // モーダル外をクリックで閉じる
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });

    // フォームの変更を監視
    const form = document.getElementById('nicolive_settings_form');
    form.addEventListener('change', saveModalOptions);

    // サイズ入力のblurイベント
    const window_w_input = qInput(document, 'input[name="window_w"]');
    const window_h_input = qInput(document, 'input[name="window_h"]');

    window_w_input.addEventListener('blur', () => {
        window_w_input.value = String(convertInt(window_w_input.value, options.window_w));
        saveModalOptions();
    });

    window_h_input.addEventListener('blur', () => {
        window_h_input.value = String(convertInt(window_h_input.value, options.window_h));
        saveModalOptions();
    });

    // アスペクト比ボタン
    const aspectButton = document.getElementById('nicolive_aspect_button');
    aspectButton.addEventListener('click', () => {
        const width = Number(convertInt(window_w_input.value, options.window_w));
        const height = Math.round(width * (9 / 16));
        window_h_input.value = String(height);
        saveModalOptions();
    });
}

// モーダルの設定を保存
async function saveModalOptions() {
    const form = document.getElementById('nicolive_settings_form');
    
    options.windowmode = qInput(form, 'input[name="windowmode"]:checked').value;
    options.screenmode = qInput(form, 'input[name="screenmode"]:checked').value;
    options.window_w = qInput(form, 'input[name="window_w"]').value;
    options.window_h = qInput(form, 'input[name="window_h"]').value;
    options.alwaysOnTop = qInput(form, 'input[name="alwaysOnTop"]').checked;

    await chrome.storage.local.set(options);
}

// 数値フォームを監視　強制的に数値に変換
/**
 * 文字列を正の整数に変換（全角は半角化）。不正なら defaultVal を返す
 * @param {string} value
 * @param {number|string} defaultVal
 * @returns {number|string}
 */
function convertInt(value, defaultVal) {
    // 全角を半角に変換
    value = value.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) {
        return String.fromCharCode(s.charCodeAt(0) - 65248);
    }).replace(/[^\u0000-\u007E]/g, "");

    // 数値に変換
    let value_ = parseInt(value, 10);

    // 数値でなければデフォルト値を返す
    if (isNaN(value_)) {
        return defaultVal;
    }
    // 整数でなければデフォルト値を返す
    if (!Number.isInteger(value_)) {
        return defaultVal;
    }
    // 正数でなければデフォルト値を返す
    if (value_ <= 0) {
        return defaultVal;
    }
    return value_;
}
