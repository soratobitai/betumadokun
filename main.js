let defaultOptions = {
    windowmode: '2',
    screenmode: '1',
    window_w: 500,
    window_h: 281.3,
};
let options = {};
const linkIconURL = chrome.runtime.getURL('images/link.png');
const linkButton = `<div class="nicolive_link_button_wrap"><div class="nicolive_link_button"><img src="${linkIconURL}"></div></div>`;

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

    // 監視対象の要素の親ノード
    const parentNode = document.body;

    // 別窓くんボタンを追加
    document.querySelectorAll('img').forEach(function (imageElement) {
        insertPopupButton(imageElement);
    });

    /**
     * 番組リンクが挿入されたら別窓くんボタンを追加
     */
    // MutationObserverを作成
    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                node.querySelectorAll('img').forEach(function (imageElement) {
                    insertPopupButton(imageElement);
                });
            });
        });
    });

    // MutationObserverを開始
    observer.observe(parentNode, { childList: true, subtree: true });
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

    // anchorElementの最後に挿入
    imageElement.insertAdjacentHTML('afterend', linkButton);

    // フレームがある場合は位置をズラす
    if (hasNicoadFrame(imageElement)) {
        const nicolive_link_button_wrap = anchorElement.querySelector('.nicolive_link_button_wrap');
        if (nicolive_link_button_wrap) {
            nicolive_link_button_wrap.style.top = '30px';
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

    // ホバー時にボタン表示
    anchorElement.addEventListener('mouseover', function () {
        nicolive_link_button.classList.add('nicolive_link_button_active');
    });
    anchorElement.addEventListener('mouseleave', function () {
        nicolive_link_button.classList.remove('nicolive_link_button_active');
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
