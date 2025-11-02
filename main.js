let defaultOptions = {
    windowmode: '2',
    screenmode: '1',
    window_w: 500,
    window_h: 281.3,
};
let options = {};
const linkIconURL = chrome.runtime.getURL('images/link.png');
const linkButton = `<div class="nicolive_link_button_wrap"><div class="nicolive_link_button"><img src="${linkIconURL}"></div></div>`;
const settingsButton = `<div class="nicolive_settings_button_wrap"><div class="nicolive_settings_button">⚙</div></div>`;

let openedWindows = [];
let focusOpenedWindowFlag = true;
let windowPositionOffset = 30;

/**
 * ブラウザがアイドル状態になったときに処理を実行する
 * 古いブラウザ向けに fallback として setTimeout を使用
 * @param {Function} callback - 実行したい処理
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


function isTargetImage(imageElement) {
    const parentNode = imageElement.parentNode;

    // リンクが貼られているか
    if (parentNode.tagName.toLowerCase() !== 'a' || !parentNode.href) return false;

    // ニコ生の番組へのリンクかどうか
    const allowedURLs = [
        'live.nicovideo.jp/watch/lv',
        // 'api.nicoad.nicovideo.jp/v1/nicoad/' // 広告リンクは視聴ページへ転送される（CORS制限あり）仕組みなので対応不可
    ];
    if (!allowedURLs.some(url => parentNode.href.includes(url))) return false;

    return true;
}

async function insertPopupButton(imageElement) {
    if (!isTargetImage(imageElement)) return;

    const anchorElement = imageElement.parentNode;

    // ボタンが既にある場合はスルー
    if (anchorElement.querySelector('.nicolive_link_button_wrap')) return;

    // anchorElementの最後に挿入（別窓ボタンと設定ボタン）
    imageElement.insertAdjacentHTML('afterend', linkButton + settingsButton);

    // フレームがある場合は位置をズラす
    if (hasNicoadFrame(imageElement)) {
        const nicolive_link_button_wrap = anchorElement.querySelector('.nicolive_link_button_wrap');
        if (nicolive_link_button_wrap) {
            nicolive_link_button_wrap.style.top = '30px';
        }
        const nicolive_settings_button_wrap = anchorElement.querySelector('.nicolive_settings_button_wrap');
        if (nicolive_settings_button_wrap) {
            nicolive_settings_button_wrap.style.bottom = '30px';
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

function hasNicoadFrame(element) {
    while (element) {
        if (element.classList && Array.from(element.classList).some(className => className.includes('nicoad-frame'))) {
            return true;
        }
        element = element.parentElement;
    }
    return false;
}

function focusOpenedWindows() {
    openedWindows.forEach(function (win) {
        win.focus();
    });
}

function addActions(anchorElement) {

    const liveUrl = anchorElement.href;
    const nicolive_link_button = anchorElement.querySelector('.nicolive_link_button');
    const nicolive_settings_button = anchorElement.querySelector('.nicolive_settings_button');

    nicolive_link_button.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        focusOpenedWindows();

        // シングル
        if (options.windowmode === '1') {
            window.open(`${liveUrl}?&popup=on&screenmode=${options.screenmode}`, null, `width=${options.window_w},height=${options.window_h},resizable=yes,location=no,toolbar=no,menubar=no`);
        }
        // 多窓
        if (options.windowmode === '2') {
            const position = openedWindows.length * windowPositionOffset;
            const win = window.open(`${liveUrl}?&popup=on&screenmode=${options.screenmode}`, '_blank', `width=${options.window_w},height=${options.window_h},top=${position},left=${position},resizable=yes,location=no,toolbar=no,menubar=no`);
            
            // ウィンドウリストに追加　＆　イベント追加
            openedWindows.push(win);
            win.addEventListener('focus', (event) => {
                if (!focusOpenedWindowFlag) return;
                focusOpenedWindowFlag = false;
                setTimeout(() => focusOpenedWindowFlag = true, 500);
                focusOpenedWindows();
            });
            win.addEventListener('unload', (event) => {
                if (event.currentTarget.location.href === 'about:blank') return;
                openedWindows = openedWindows.filter(win_ => win_.location.href !== event.currentTarget.location.href); // ウィンドウを閉じたらリストから削除
            });
        }
        // タブ
        if (options.windowmode === '3') {
            window.open(`${liveUrl}`);
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
});

// オプションを取得
const getOptions = async () => {

    const options_ = await chrome.storage.local.get();
    if (!options_) return defaultOptions;

    if (options_.windowmode === undefined) options_.windowmode = defaultOptions.windowmode;
    if (options_.screenmode === undefined) options_.screenmode = defaultOptions.screenmode;
    if (options_.window_w === undefined) options_.window_w = defaultOptions.window_w;
    if (options_.window_h === undefined) options_.window_h = defaultOptions.window_h;

    return options_;
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
                                <p class="nicolive_option_desc">ライブ映像のみのシンプルな表示。コメントや音量調整などの操作はできません。</p>
                            </div>
                            <div class="nicolive_option_item">
                                <label>
                                    <input type="radio" name="screenmode" value="2">
                                    <span class="nicolive_label_text">多機能</span>
                                </label>
                                <p class="nicolive_option_desc">
                                    コメントや音量調節など（ニコ生の標準機能）が利用できます。<br>
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

// モーダルの初期値を設定
function initializeModalValues() {
    // 別窓モード
    document.querySelectorAll('input[name="windowmode"]').forEach(input => {
        input.checked = input.value === options.windowmode;
    });

    // 映像モード
    document.querySelectorAll('input[name="screenmode"]').forEach(input => {
        input.checked = input.value === options.screenmode;
    });

    // 別窓サイズ
    document.querySelector('input[name="window_w"]').value = options.window_w;
    document.querySelector('input[name="window_h"]').value = options.window_h;
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
    const window_w_input = form.querySelector('input[name="window_w"]');
    const window_h_input = form.querySelector('input[name="window_h"]');

    window_w_input.addEventListener('blur', (e) => {
        const value = convertInt(e.target.value, options.window_w);
        e.target.value = value;
        saveModalOptions();
    });

    window_h_input.addEventListener('blur', (e) => {
        const value = convertInt(e.target.value, options.window_h);
        e.target.value = value;
        saveModalOptions();
    });

    // アスペクト比ボタン
    const aspectButton = document.getElementById('nicolive_aspect_button');
    aspectButton.addEventListener('click', () => {
        const width = parseInt(window_w_input.value, 10);
        const height = Math.round((width * (9 / 16)) * 10) / 10;
        window_h_input.value = height;
        saveModalOptions();
    });
}

// モーダルの設定を保存
async function saveModalOptions() {
    const form = document.getElementById('nicolive_settings_form');
    
    options.windowmode = form.querySelector('input[name="windowmode"]:checked').value;
    options.screenmode = form.querySelector('input[name="screenmode"]:checked').value;
    options.window_w = form.querySelector('input[name="window_w"]').value;
    options.window_h = form.querySelector('input[name="window_h"]').value;

    await chrome.storage.local.set(options);
}

// 数値フォームを監視　強制的に数値に変換
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
