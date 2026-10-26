// @ts-check

/**
 * 拡張の設定値
 * @typedef {Object} Options
 * @property {string} windowmode  別窓モード '1'=シングル / '2'=多窓 / '3'=タブ
 * @property {string} screenmode  映像モード '1'=シンプル / '2'=多機能 / '3'=軽量
 * @property {number|string} window_w  別窓の幅(px)。既定は数値、フォーム入力経由では文字列
 * @property {number|string} window_h  別窓の高さ(px)。既定は数値、フォーム入力経由では文字列
 * @property {boolean} alwaysOnTop  別窓を常に手前に表示するか
 * @property {boolean} liteComments  軽量モードで映像の上にコメントを流すか（lite.js が読む）
 * @property {string} liteQuality  軽量モードの画質 'window'=窓に合わせる / 'site'=ニコ生の設定に合わせる（lite.js が読む）
 */

/** @type {Options} */
let defaultOptions = {
    windowmode: '2',
    screenmode: '3',
    window_w: 500,
    window_h: 281,
    alwaysOnTop: false,
    liteComments: false,
    liteQuality: 'window',
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

    // 「常に手前」有効時は、別窓の有無に関わらず本ページ操作の監視を開始しておく（別窓の中では開始しない）。
    // 前面化は SW が chrome.windows.getAll で別窓を特定して行うため、本ページが別窓を
    // 追跡していなくても（例：別番組へ移動した直後）本ページ操作で前面化を依頼できる。
    if (options.alwaysOnTop) startAlwaysOnTopMonitoring();
    if (!isInsideOurPopup()) refreshPopupCount();

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

/**
 * ニコニ広告フレームのカードか判定する（カードの <a> href が広告リダイレクト api.nicoad）。
 * 広告枠は右上にフレーム装飾があり別窓ボタンが隠れる（装飾は祖先 article 側のため
 * isTopRightOccupied では検知できない）。この場合は配置を右辺中央へ寄せる。
 * @param {Element|null} cardEl カード全体（番組リンク <a>）
 * @returns {boolean}
 */
function isNicoadCard(cardEl) {
    const href = cardEl && /** @type {HTMLAnchorElement} */ (cardEl).href;
    return !!href && href.includes('api.nicoad.nicovideo.jp');
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
        if (!wrap || !card) return;
        // ニコニ広告フレームは右上にフレーム装飾があり別窓ボタンが隠れるため、常に右辺中央へ配置する。
        // それ以外は「右上がカード外の要素で覆われている時」だけ中央へ退避する。
        if (isNicoadCard(card) || isTopRightOccupied(container, card)) {
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

// mousedown がテキスト入力・操作系の要素上で起きたか。
// コメント欄などをクリックした瞬間に別窓を前面化するとフォーカスが奪われて入力できないため、
// その場合は前面化しない。Shadow DOM 内のコメント欄でも実要素を拾えるよう composedPath() を走査する
// （window レベルでは e.target が shadow host に retarget され判定漏れするため）。
/**
 * @param {Event} e
 * @returns {boolean}
 */
function isEditableClick(e) {
    const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
    const nodes = path.length ? path : (e.target ? [e.target] : []);
    for (const n of nodes) {
        if (!(n instanceof HTMLElement)) continue;
        const tag = n.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
        if (n.isContentEditable) return true;
        // ニコ生のコメント欄が div[role="textbox"] 等の可能性に備える
        const role = n.getAttribute('role');
        if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;
    }
    return false;
}

// この文書が別窓くんの別窓（またはその中の同じオリジンの枠）か。
// main.js は live.nicovideo.jp の全ページ（別窓を含む）で動くため、別窓の中では「常に手前」の監視をしない
// （別窓の中をクリックするたびに全別窓を前面化すると、クリックした窓の上に他の別窓が来てしまう）。
// 別オリジンの枠からは判定できないが、その場合も SW 側で依頼元が別窓なら無視している。
function isInsideOurPopup() {
    try {
        return /[?&]popup=on(&|$)/.test(window.top.location.search);
    } catch (e) {
        return false;
    }
}

// mousedown が別窓くん自身のボタン（別窓・⚙）上か。これらは押した側で前面化を扱う
// （別窓ボタンは新しい窓ができてから前面化を頼み、⚙ は設定ダイアログを別窓で隠さないよう前面化しない）
/**
 * @param {Event} e
 * @returns {boolean}
 */
function isOwnButtonClick(e) {
    const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
    return path.some((n) => n instanceof HTMLElement
        && (n.classList.contains('nicolive_link_button') || n.classList.contains('nicolive_settings_button')));
}

function startAlwaysOnTopMonitoring() {
    if (alwaysOnTopEventHandlers.length > 0) return; // 既に開始済み
    if (isInsideOurPopup()) return;

    // 本ページを操作したら別窓群を前面へ戻す。
    // ・監視は mousedown のみ（旧: mousedown/click/focus）。focus 起点の再フォーカスは
    //   フォーカス争奪・ループ・本ページ操作不能の主因だった。
    // ・左ボタンのみ。右クリックメニューや中クリックのスクロールを、前面化によるフォーカス移動で壊さない。
    // ・leading-edge スロットルで、連続操作時に前面化の依頼が連発しないようにする。
    // ・入力系要素（コメント欄など）のクリックでは前面化しない（入力を奪わない）。
    /** @param {Event} e */
    const handler = (e) => {
        if (!options.alwaysOnTop) return;
        if (/** @type {MouseEvent} */ (e).button !== 0) return;
        if (isEditableClick(e) || isOwnButtonClick(e)) return;
        // 設定ダイアログを開いている間は前面化しない（別窓がダイアログに重なって操作しづらくなるため）
        if (document.getElementById(SETTINGS_HOST_ID)) return;
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

// ===== 別窓の追跡 =====
// 前面化（常に手前）は SW が URL で別窓を見つけて行うので、ここでの追跡は「常に手前」がオフのときの
// 前面化（別窓ボタンで既存の別窓を手前へ）にだけ使う。
// ・閉じたかは win.closed を定期的に確かめる。unload は「実際に閉じた」と「再ナビゲーション（シングルの窓の
//   使い回し・軽量から通常表示への切り替え）」を区別できず、再ナビゲーション後は新しい文書に付け直されないため
//   使わない。WindowProxy の closed は、窓が別の番組へ移っても正しく保たれる。
// ・本ページを移動すると追跡は消えるが、名前で取り直す（window.open('', name)）ことはしない。閉じた窓の名前で
//   呼ぶと空白の窓が開いてしまうため。多窓の位置ずらしは SW に別窓を数えてもらう（refreshPopupCount）。

/** SW が数えた、いま開いている別窓の数（多窓で新しい窓を開く位置をずらすのに使う） */
let popupCount = 0;
let closedCheckTimer = 0;

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

// いま開いている別窓の数を SW に数えてもらう（読み込み時と、別窓ボタンにカーソルを載せた時）
function refreshPopupCount() {
    try {
        chrome.runtime.sendMessage({ type: 'COUNT_POPUPS' }, (n) => {
            void chrome.runtime.lastError;
            if (typeof n === 'number') popupCount = n;
        });
    } catch (e) { /* 拡張コンテキスト無効時は無視 */ }
}

// 別窓を追跡リストに加え、閉じたら外す（シングル・多窓で共通）
/** @param {Window} win */
function trackOpenedWindow(win) {
    if (!openedWindows.includes(win)) openedWindows.push(win);
    if (closedCheckTimer) return;
    closedCheckTimer = window.setInterval(() => {
        openedWindows = openedWindows.filter((w) => {
            try {
                return !w.closed;
            } catch (e) {
                return false;
            }
        });
        if (openedWindows.length === 0) {
            clearInterval(closedCheckTimer);
            closedCheckTimer = 0;
        }
    }, 1000);
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

    // 開く前に別窓の数を数え直しておく（多窓で新しい窓を開く位置をずらすため）
    nicolive_link_button.addEventListener('mouseenter', refreshPopupCount);

    nicolive_link_button.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        // 常に手前がオフ: 開く前に既存の別窓を手前へ（従来どおり）。オンのときは開いた後に SW へ頼む
        if (!options.alwaysOnTop) focusOpenedWindows();

        const url = `${liveUrl}?&popup=on&screenmode=${options.screenmode}`;

        // シングル（常に同じ名前の窓を再利用。閉じた窓は追跡側が外すので、ここでは足すだけ）
        if (options.windowmode === '1') {
            const win = window.open(url, 'betsumado_single', `width=${options.window_w},height=${options.window_h},resizable=yes,location=no,toolbar=no,menubar=no`);
            if (win) trackOpenedWindow(win);
        }
        // 多窓（毎回新しい名前で開き、開いている別窓の数だけ位置をずらす）
        if (options.windowmode === '2') {
            const position = Math.max(popupCount, openedWindows.length) * windowPositionOffset;
            const win = window.open(url, makePopupName(), `width=${options.window_w},height=${options.window_h},top=${position},left=${position},resizable=yes,location=no,toolbar=no,menubar=no`);
            if (win) {
                trackOpenedWindow(win);
                popupCount++;
            }
        }
        // タブ
        if (options.windowmode === '3') {
            window.open(`${liveUrl}`);
        }

        // 常に手前: 新しい窓ができてから前面化を頼む（先に頼むと、古い別窓が新しい窓の上に来ることがある）。
        // SW は古い順に前面化するので、最後に新しい窓が最前面になる
        if (options.alwaysOnTop && options.windowmode !== '3') {
            startAlwaysOnTopMonitoring();
            setTimeout(focusOpenedWindows, 400);
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
    if (changes.liteComments) options.liteComments = changes.liteComments.newValue;
    if (changes.liteQuality) options.liteQuality = changes.liteQuality.newValue;
    if (changes.alwaysOnTop) {
        options.alwaysOnTop = changes.alwaysOnTop.newValue;
        // オンなら（追跡中の別窓の有無に関わらず）監視を始め、オフなら止める
        if (options.alwaysOnTop) startAlwaysOnTopMonitoring();
        else stopAlwaysOnTopMonitoring();
    }
});

// オプションを取得（保存値で既定値を上書きして返す）
/** @returns {Promise<Options>} */
const getOptions = async () => {
    const stored = await chrome.storage.local.get();
    return /** @type {Options} */ ({ ...defaultOptions, ...stored });
};

// ===== 設定ダイアログ =====
// 各サイト（live / www / blog / ちくわちゃん）の CSS に崩されないよう Shadow DOM に入れ、
// <dialog>（最前面に表示・Esc で閉じる）で開く。見た目は settings.css。

const SETTINGS_HOST_ID = 'betsumado_settings_host';

/** 設定ダイアログで使うアイコン */
const SETTINGS_ICON = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="13" height="10" rx="2"/><path d="M8 18h11a2 2 0 0 0 2-2V9"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9.2l2.6 2.6L13 6.4"/></svg>',
    info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 7.2v3.8M8 5h.01"/></svg>',
};

/** 選択カードの絵柄（44×30）。.bm-fill は手前の窓をカードの背景色で塗って重なりを表す */
const SETTINGS_PICT = {
    single: '<rect x="9" y="4" width="26" height="22" rx="3"/><path d="M9 10h26"/>',
    multi: '<rect x="5" y="3" width="22" height="17" rx="2.5"/><path d="M5 8h22"/><rect class="bm-fill" x="17" y="10" width="22" height="17" rx="2.5"/><path d="M17 15h22"/>',
    tab: '<rect x="5" y="4" width="34" height="22" rx="2.5"/><path d="M5 11h34"/><path d="M9 11V8.2A1.2 1.2 0 0 1 10.2 7h8.6A1.2 1.2 0 0 1 20 8.2V11"/><path d="M22.5 11V8.2A1.2 1.2 0 0 1 23.7 7h7.6A1.2 1.2 0 0 1 32.5 8.2V11" opacity=".45"/>',
    lite: '<rect x="6" y="4" width="32" height="22" rx="3"/><path d="M24 8.5l-6 7.5h5l-2 5.5 6-7.5h-5z" fill="currentColor" stroke="none"/>',
    simple: '<rect x="6" y="4" width="32" height="22" rx="3"/><path d="M19.5 10.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
    full: '<rect x="6" y="4" width="32" height="22" rx="3"/><path d="M12 10.5h11M17 15h15M11 19.5h9"/>',
};

/**
 * 選択カード（ラジオ）の HTML
 * @param {string} name
 * @param {string} value
 * @param {string} pict
 * @param {string} label
 * @param {string} desc
 * @param {string} [badge]
 */
function settingsChoiceHtml(name, value, pict, label, desc, badge) {
    return `
        <label class="bm-choice">
            <input type="radio" name="${name}" value="${value}">
            <svg class="bm-pict" viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pict}</svg>
            <span class="bm-choice-name">${label}${badge ? `<span class="bm-badge">${badge}</span>` : ''}</span>
            <span class="bm-choice-desc">${desc}</span>
            <span class="bm-check">${SETTINGS_ICON.check}</span>
        </label>`;
}

// 設定ダイアログを開く
function openSettingsModal() {
    document.getElementById(SETTINGS_HOST_ID)?.remove();

    const host = document.createElement('div');
    host.id = SETTINGS_HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
        <link rel="stylesheet" href="${chrome.runtime.getURL('settings.css')}">
        <dialog lang="ja" aria-labelledby="bm_title" tabindex="-1">
            <div class="bm-header">
                <span class="bm-logo">${SETTINGS_ICON.logo}</span>
                <h2 class="bm-title" id="bm_title">別窓くん<small>設定</small></h2>
                <button type="button" class="bm-close" aria-label="閉じる">${SETTINGS_ICON.close}</button>
            </div>
            <form class="bm-body" id="bm_form">
                <div class="bm-section" role="radiogroup" aria-labelledby="bm_windowmode_title">
                    <div class="bm-section-title" id="bm_windowmode_title">別窓モード</div>
                    <div class="bm-choices">
                        ${settingsChoiceHtml('windowmode', '1', SETTINGS_PICT.single, 'シングル', '1つの窓で番組を切り替え')}
                        ${settingsChoiceHtml('windowmode', '2', SETTINGS_PICT.multi, '多窓', '番組ごとに新しい窓で開く')}
                        ${settingsChoiceHtml('windowmode', '3', SETTINGS_PICT.tab, 'タブ', '新しいタブで開く')}
                    </div>
                    <div class="bm-note bm-note-info bm-note-tab">${SETTINGS_ICON.info}<span>タブで開くときは、映像モード・別窓サイズ・常に手前は使われません。</span></div>
                </div>
                <div class="bm-section bm-window-only" role="radiogroup" aria-labelledby="bm_screenmode_title">
                    <div class="bm-section-title" id="bm_screenmode_title">映像モード</div>
                    <div class="bm-choices">
                        ${settingsChoiceHtml('screenmode', '3', SETTINGS_PICT.lite, '軽量', '映像を軽く再生。開くのが速く多窓向き', 'おすすめ')}
                        ${settingsChoiceHtml('screenmode', '1', SETTINGS_PICT.simple, 'シンプル', '公式プレイヤーで映像だけを表示')}
                        ${settingsChoiceHtml('screenmode', '2', SETTINGS_PICT.full, '多機能', 'コメントなどニコ生の機能が使える')}
                    </div>
                    <div class="bm-rows bm-lite-only">
                        <div class="bm-row">
                            <span class="bm-row-text">
                                <span class="bm-row-label">画質<span class="bm-row-tag">軽量</span></span>
                                <span class="bm-row-desc bm-desc-window">窓の大きさに見合う画質で再生します（480p以上）</span>
                                <span class="bm-row-desc bm-desc-site">ニコ生のプレイヤーで選んでいる画質で再生します</span>
                            </span>
                            <span class="bm-seg" role="radiogroup" aria-label="画質">
                                <label><input type="radio" name="liteQuality" value="window"><span>窓に合わせる</span></label>
                                <label><input type="radio" name="liteQuality" value="site"><span>ニコ生の設定</span></label>
                            </span>
                        </div>
                        <label class="bm-row">
                            <span class="bm-row-text">
                                <span class="bm-row-label">コメントを流す<span class="bm-row-tag">軽量</span></span>
                                <span class="bm-row-desc">映像の上にコメントを流します（表示のみ・オンにすると負荷が増えます）</span>
                            </span>
                            <input class="bm-switch" type="checkbox" role="switch" name="liteComments">
                        </label>
                    </div>
                    <div class="bm-note bm-note-multi">${SETTINGS_ICON.info}<span>ニコ生の画面設定で「フルスクリーンサイズ」を「ブラウザサイズ」にしてください。「モニタサイズ」だと別窓になりません。</span></div>
                </div>
                <div class="bm-rows bm-window-only">
                    <div class="bm-row">
                        <span class="bm-row-text">
                            <span class="bm-row-label">別窓サイズ</span>
                            <span class="bm-row-desc">幅 × 高さ（px）</span>
                        </span>
                        <span class="bm-size">
                            <input class="bm-size-input" type="text" inputmode="numeric" name="window_w" aria-label="幅">
                            <span class="bm-size-x">×</span>
                            <input class="bm-size-input" type="text" inputmode="numeric" name="window_h" aria-label="高さ">
                            <button type="button" class="bm-ghost-btn" id="bm_aspect" title="幅に合わせて高さを16:9にします">16:9</button>
                        </span>
                    </div>
                    <label class="bm-row">
                        <span class="bm-row-text">
                            <span class="bm-row-label">常に手前に表示</span>
                            <span class="bm-row-desc">元のページを操作しても、別窓を前面に保ちます</span>
                        </span>
                        <input class="bm-switch" type="checkbox" role="switch" name="alwaysOnTop">
                    </label>
                </div>
            </form>
            <div class="bm-footer">
                <span class="bm-saved">${SETTINGS_ICON.check}変更はすぐに保存されます</span>
                <span>v${chrome.runtime.getManifest().version}</span>
            </div>
        </dialog>`;
    (document.body || document.documentElement).appendChild(host);

    const dialog = /** @type {HTMLDialogElement} */ (root.querySelector('dialog'));
    initializeModalValues(root);
    addModalEventListeners(root, dialog);
    dialog.addEventListener('close', () => host.remove());

    // スタイルを読み込んでから開く（素の見た目を一瞬でも見せない）
    let shown = false;
    const show = () => {
        if (shown || !host.isConnected) return;
        shown = true;
        dialog.showModal();
        dialog.focus(); // 最初のボタン（×）ではなくダイアログ自体にフォーカスする（Enter で誤って閉じないように）
    };
    const link = /** @type {HTMLLinkElement} */ (root.querySelector('link'));
    link.addEventListener('load', show);
    link.addEventListener('error', show);
    setTimeout(show, 500);
}

// セレクタで input 要素を型付き取得するヘルパー
/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
const qInput = (root, selector) => /** @type {HTMLInputElement} */ (root.querySelector(selector));

// ダイアログの初期値を設定
/** @param {ShadowRoot} root */
function initializeModalValues(root) {
    // 別窓モード
    root.querySelectorAll('input[name="windowmode"]').forEach(input => {
        const el = /** @type {HTMLInputElement} */ (input);
        el.checked = el.value === options.windowmode;
    });

    // 映像モード
    root.querySelectorAll('input[name="screenmode"]').forEach(input => {
        const el = /** @type {HTMLInputElement} */ (input);
        el.checked = el.value === options.screenmode;
    });

    // 画質（軽量）
    root.querySelectorAll('input[name="liteQuality"]').forEach(input => {
        const el = /** @type {HTMLInputElement} */ (input);
        el.checked = el.value === options.liteQuality;
    });

    // 別窓サイズ
    qInput(root, 'input[name="window_w"]').value = String(options.window_w);
    qInput(root, 'input[name="window_h"]').value = String(options.window_h);

    // 常に手前・コメント（軽量）
    qInput(root, 'input[name="alwaysOnTop"]').checked = options.alwaysOnTop;
    qInput(root, 'input[name="liteComments"]').checked = options.liteComments;

    syncModalState(root);
}

// 選択に応じて補足（多機能の注意・タブでは使われない設定）を出し分ける（表示の切り替えは settings.css）
/** @param {ShadowRoot} root */
function syncModalState(root) {
    const form = /** @type {HTMLFormElement} */ (root.getElementById('bm_form'));
    form.dataset.windowmode = qInput(form, 'input[name="windowmode"]:checked')?.value || '';
    form.dataset.screenmode = qInput(form, 'input[name="screenmode"]:checked')?.value || '';
    form.dataset.litequality = qInput(form, 'input[name="liteQuality"]:checked')?.value || '';
}

// ダイアログのイベントリスナーを追加
/**
 * @param {ShadowRoot} root
 * @param {HTMLDialogElement} dialog
 */
function addModalEventListeners(root, dialog) {
    // 閉じるボタン（Esc はダイアログ標準で閉じる）
    root.querySelector('.bm-close').addEventListener('click', () => dialog.close());

    // 背景（ダイアログの外）をクリックしたら閉じる。中で押して外で離した（入力欄の文字選択など）ときは閉じない
    let downOnBackdrop = false;
    dialog.addEventListener('mousedown', (e) => {
        downOnBackdrop = e.target === dialog;
    });
    dialog.addEventListener('click', (e) => {
        if (downOnBackdrop && e.target === dialog) dialog.close();
    });

    // 変更はその場で保存する
    const form = /** @type {HTMLFormElement} */ (root.getElementById('bm_form'));
    form.addEventListener('change', () => {
        syncModalState(root);
        saveModalOptions(root);
    });
    form.addEventListener('submit', (e) => e.preventDefault()); // Enter でページが再読み込みされないように

    // サイズ入力のblurイベント
    const window_w_input = qInput(root, 'input[name="window_w"]');
    const window_h_input = qInput(root, 'input[name="window_h"]');

    window_w_input.addEventListener('blur', () => {
        window_w_input.value = String(convertInt(window_w_input.value, options.window_w));
        saveModalOptions(root);
    });

    window_h_input.addEventListener('blur', () => {
        window_h_input.value = String(convertInt(window_h_input.value, options.window_h));
        saveModalOptions(root);
    });

    // アスペクト比ボタン
    root.getElementById('bm_aspect').addEventListener('click', () => {
        const width = Number(convertInt(window_w_input.value, options.window_w));
        const height = Math.round(width * (9 / 16));
        window_h_input.value = String(height);
        saveModalOptions(root);
    });
}

// ダイアログの設定を保存
/** @param {ShadowRoot} root */
async function saveModalOptions(root) {
    options.windowmode = qInput(root, 'input[name="windowmode"]:checked').value;
    options.screenmode = qInput(root, 'input[name="screenmode"]:checked').value;
    options.window_w = qInput(root, 'input[name="window_w"]').value;
    options.window_h = qInput(root, 'input[name="window_h"]').value;
    options.alwaysOnTop = qInput(root, 'input[name="alwaysOnTop"]').checked;
    options.liteComments = qInput(root, 'input[name="liteComments"]').checked;
    options.liteQuality = qInput(root, 'input[name="liteQuality"]:checked').value;

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
