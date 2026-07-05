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
let focusOpenedWindowFlag = true;
let windowPositionOffset = 30;
/** @type {Window|null} */
let lastActiveWindow = null; // 最後にアクティブだった別窓を記録
/** @type {Map<Window, number>} */
let windowFocusOrder = new Map(); // 各ウィンドウのフォーカス順序を記録（タイムスタンプ + 開いた順序）

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

runWhenIdle(async () => {
    // オプションを取得
    options = await getOptions();

    // マウスオーバー時に対象判定し、未作成ならボタンを作成して表示
    document.addEventListener('mouseover', function (event) {
        const target = event.target;
        if (!target || !(target instanceof Element)) return;

        const imageElement = target.closest && target.closest('img');
        if (!imageElement) return;

        if (!isTargetImage(imageElement)) return;

        const anchorElement = imageElement.parentNode;

        // 初回のみ作成
        if (!anchorElement.querySelector('.nicolive_link_button_wrap')) {
            insertPopupButton(imageElement);
        }

        // 既存/新規問わず、現在のホバーで確実に表示
        const nicolive_link_button = anchorElement.querySelector('.nicolive_link_button');
        if (nicolive_link_button) {
            nicolive_link_button.classList.add('nicolive_link_button_active');
        }
        const nicolive_settings_button = anchorElement.querySelector('.nicolive_settings_button');
        if (nicolive_settings_button) {
            nicolive_settings_button.classList.add('nicolive_settings_button_active');
        }
    });
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
 * 画像がニコ生番組リンク配下の対象画像か判定する（通常サムネ＋ニコニ広告サムネ）
 * @param {Element} imageElement
 * @returns {boolean}
 */
function isTargetImage(imageElement) {
    const parentNode = /** @type {HTMLAnchorElement} */ (imageElement.parentNode);

    // 画像の親がリンク(<a>)か
    if (parentNode.tagName.toLowerCase() !== 'a' || !parentNode.href) return false;

    // 視聴ページURLを解決できるものだけ対象にする
    return resolveWatchUrl(parentNode) !== null;
}

/**
 * サムネイル画像に別窓ボタン・設定ボタンを挿入する
 * @param {Element} imageElement
 */
async function insertPopupButton(imageElement) {
    if (!isTargetImage(imageElement)) return;

    const anchorElement = /** @type {HTMLAnchorElement} */ (imageElement.parentNode);

    // ボタンが既にある場合はスルー
    if (anchorElement.querySelector('.nicolive_link_button_wrap')) return;

    // 別窓ボタンの配置を決める：右上が予約ボタン等で埋まっている場合のみ右辺中央へ退避する
    // （通常サムネ・広告サムネ共通。判定は挿入前に行う＝自前ボタンを誤検出しないため）
    const useCenter = isTopRightOccupied(anchorElement);

    // anchorElementの最後に挿入（別窓ボタンと設定ボタン）
    imageElement.insertAdjacentHTML('afterend', linkButton + settingsButton);

    if (useCenter) {
        const nicolive_link_button_wrap = /** @type {HTMLElement} */ (anchorElement.querySelector('.nicolive_link_button_wrap'));
        if (nicolive_link_button_wrap) {
            nicolive_link_button_wrap.classList.add('nicolive_link_button_wrap_center');
        }
    }

    // relative
    if (!anchorElement.style.position) {
        anchorElement.style.position = 'relative';
        anchorElement.style.overflow = 'visible';
    }

    // クリックイベントなど追加
    addActions(anchorElement);
}

/**
 * ボタン設置予定地（アンカー右上・約17px内側）が、番組リンク(anchor)外の別要素で
 * 覆われているか判定する。覆われていれば別窓ボタンを右辺中央へ退避する。
 * ニコ生のクラス名には依存しない（座標ベース）。判定不能時は安全側で true を返す。
 * @param {Element} anchorElement 別窓ボタンを配置する番組リンク要素
 * @returns {boolean} 覆われている（＝中央へ退避すべき）なら true
 */
function isTopRightOccupied(anchorElement) {
    const rect = anchorElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return true; // 測定不能は安全側（中央）

    // 別窓ボタン（右上・約30px四方）の中心付近を調べる
    const x = rect.right - 17;
    const y = rect.top + 17;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true; // 画面外は安全側

    const topEl = document.elementFromPoint(x, y);
    if (!topEl) return true; // 取得不能は安全側

    // anchor 内の要素（番組画像や自前ボタン）や anchor の祖先コンテナ ＝ 重なりではない
    if (anchorElement.contains(topEl)) return false;
    if (topEl.contains(anchorElement)) return false;

    // それ以外（anchor 外の別要素が右上に重なっている）＝覆われている
    return true;
}

let focusOrderCounter = 0; // フォーカス順序のカウンター

function focusOpenedWindows() {
    // 「常に手前に表示」が有効な場合
    if (options.alwaysOnTop) {
        // 重なり順を維持するため、フォーカス順序の古い順（下から順）にフォーカス
        const sortedWindows = openedWindows
            .filter(win => {
                try {
                    return !win.closed;
                } catch (e) {
                    return false;
                }
            })
            .sort((a, b) => {
                const orderA = windowFocusOrder.get(a) || 0;
                const orderB = windowFocusOrder.get(b) || 0;
                return orderA - orderB; // 古い順（小さい値が先）
            });
        
        // 古い順にフォーカス = 最後にフォーカスされたものが一番上に来る
        sortedWindows.forEach(function (win) {
            try {
                win.focus();
            } catch (e) {
                // エラーを無視
            }
        });
        return;
    }
    
    // 通常の動作（多窓機能）: すべての別窓を順番にフォーカス
    openedWindows.forEach(function (win) {
        win.focus();
    });
}

// 別窓からアクセスできるようにグローバルに公開
window.focusOpenedWindows = focusOpenedWindows;

// 常に手前に表示する設定
/** @type {{ type: string, handler: EventListener }[]} */
let alwaysOnTopEventHandlers = [];

function startAlwaysOnTopMonitoring() {
    if (alwaysOnTopEventHandlers.length > 0) return; // 既に開始済み
    
    // イベントハンドラ - 既存の focusOpenedWindows を利用
    const handler = () => {
        // スクリプトによるフォーカスとして記録されないようにフラグを設定
        focusOpenedWindowFlag = false;
        focusOpenedWindows();
        // 少し遅延させてからフラグを戻す
        setTimeout(() => focusOpenedWindowFlag = true, 100);
    };
    
    // 監視するイベント
    const events = ['mousedown', 'click', 'focus'];
    
    events.forEach(eventType => {
        window.addEventListener(eventType, handler, true);
        alwaysOnTopEventHandlers.push({ type: eventType, handler });
    });
}

function stopAlwaysOnTopMonitoring() {
    alwaysOnTopEventHandlers.forEach(({ type, handler }) => {
        window.removeEventListener(type, handler, true);
    });
    alwaysOnTopEventHandlers = [];
}

// 別窓を追跡リストに追加し、フォーカス/クローズ（unload）を監視する
// シングル・多窓で共通のトラッキング処理
/** @param {Window} win */
function trackOpenedWindow(win) {
    openedWindows.push(win);
    lastActiveWindow = win; // 開いた直後は最後のアクティブウィンドウとして記録
    windowFocusOrder.set(win, ++focusOrderCounter); // フォーカス順序を記録

    win.addEventListener('focus', () => {
        if (!focusOpenedWindowFlag) return;
        focusOpenedWindowFlag = false;
        setTimeout(() => focusOpenedWindowFlag = true, 500);

        // ユーザーの操作によるフォーカスのみ記録
        lastActiveWindow = win;
        windowFocusOrder.set(win, ++focusOrderCounter); // フォーカス順序を更新

        // 「常に手前に表示」が有効な場合のみ、他の別窓も一緒に前面に
        if (options.alwaysOnTop) {
            focusOpenedWindows();
        }
    });

    win.addEventListener('unload', () => {
        if (win.location.href === 'about:blank') return;
        openedWindows = openedWindows.filter(win_ => win_ !== win); // ウィンドウを閉じたらリストから削除
        windowFocusOrder.delete(win); // フォーカス順序を削除

        // 閉じられたウィンドウが最後のアクティブウィンドウだった場合
        if (lastActiveWindow === win) {
            lastActiveWindow = openedWindows.length > 0 ? openedWindows[openedWindows.length - 1] : null;
        }

        // すべてのウィンドウが閉じられたら監視を停止
        if (openedWindows.length === 0 && options.alwaysOnTop) {
            stopAlwaysOnTopMonitoring();
        }
    });
}

/** @param {HTMLAnchorElement} anchorElement */
function addActions(anchorElement) {

    // 広告サムネは href が広告リダイレクトなので、視聴ページURLへ解決してから使う
    const liveUrl = resolveWatchUrl(anchorElement) || anchorElement.href;
    const nicolive_link_button = anchorElement.querySelector('.nicolive_link_button');
    const nicolive_settings_button = anchorElement.querySelector('.nicolive_settings_button');

    nicolive_link_button.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        focusOpenedWindows();

        // シングル
        if (options.windowmode === '1') {
            const win = window.open(`${liveUrl}?&popup=on&screenmode=${options.screenmode}`, null, `width=${options.window_w},height=${options.window_h},resizable=yes,location=no,toolbar=no,menubar=no`);

            // 閉じられたウィンドウを配列から削除
            openedWindows = openedWindows.filter(w => {
                try {
                    return !w.closed;
                } catch (e) {
                    return false;
                }
            });

            if (win) trackOpenedWindow(win);
        }
        // 多窓
        if (options.windowmode === '2') {
            const position = openedWindows.length * windowPositionOffset;
            const win = window.open(`${liveUrl}?&popup=on&screenmode=${options.screenmode}`, '_blank', `width=${options.window_w},height=${options.window_h},top=${position},left=${position},resizable=yes,location=no,toolbar=no,menubar=no`);

            trackOpenedWindow(win);
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

    // ホバー時にボタン表示
    anchorElement.addEventListener('mouseover', function () {
        nicolive_link_button.classList.add('nicolive_link_button_active');
        nicolive_settings_button.classList.add('nicolive_settings_button_active');
    });
    anchorElement.addEventListener('mouseleave', function () {
        nicolive_link_button.classList.remove('nicolive_link_button_active');
        nicolive_settings_button.classList.remove('nicolive_settings_button_active');
    });
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
