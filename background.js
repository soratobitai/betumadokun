// @ts-check

// 「別窓を常に手前に表示」の前面化を担う Service Worker。
// Web の window.focus() は複数の別窓を同時に手前へ保てず（OSのアクティブ窓は1つ）、
// 本ページ移動後に再取得した別窓は上げにくい。拡張特権の chrome.windows.update なら
// opener 関係・ユーザー操作の有無に関わらず任意の窓を前面化できるため、そちらへ委譲する。

const POPUP_URL_RE = /^https:\/\/live\.nicovideo\.jp\/watch\/lv\d+/;

// 我々が開いた別窓のタブか（視聴URL ＋ popup=on マーカー）。
// popup=on は content script が別窓を開くときだけ付与するので、手動で開いた視聴ページと区別できる。
/**
 * @param {chrome.windows.Tab | undefined} tab
 * @returns {boolean}
 */
function isOurPopupTab(tab) {
    const url = (tab && (tab.url || tab.pendingUrl)) || '';
    return POPUP_URL_RE.test(url) && url.indexOf('popup=on') !== -1;
}

// 我々が開いた別窓か（ポップアップ型 ＋ 別窓のタブ1つ）
/**
 * @param {chrome.windows.Window} win
 * @returns {boolean}
 */
function isOurPopup(win) {
    return !!win && win.type === 'popup' && Array.isArray(win.tabs) && win.tabs.length === 1 && isOurPopupTab(win.tabs[0]);
}

// 別窓を古い順に返す（ポップアップ型のウィンドウだけ取得し、通常ウィンドウのタブまでは読まない）
/** @returns {Promise<chrome.windows.Window[]>} */
async function getOurPopups() {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    return wins.filter(isOurPopup).sort((a, b) => a.id - b.id); // id昇順 ≒ 生成順
}

// 全別窓を古い順→新しい順に前面化する（最後に前面化した最新窓が最前面に来る）。
// 最小化している別窓は、ユーザーが隠したものなので戻さない。
async function raisePopups() {
    /** @type {chrome.windows.Window[]} */
    let ours;
    try {
        ours = await getOurPopups();
    } catch (e) {
        return;
    }
    for (const w of ours) {
        if (w.state === 'minimized') continue;
        try {
            await chrome.windows.update(w.id, { focused: true });
        } catch (e) {
            // 閉じられている等は無視
        }
    }
}

// 前面化は1本ずつ実行する。実行中に依頼が来たら、終わった後にもう1回だけやり直す
// （並行して走ると互いの focused が入り乱れ、最後に何が手前に来るかが偶然で決まるため）。
/** @type {Promise<void> | null} */
let raising = null;
let raiseAgain = false;

function requestRaise() {
    if (raising) {
        raiseAgain = true;
        return;
    }
    raising = raisePopups().finally(() => {
        raising = null;
        if (raiseAgain) {
            raiseAgain = false;
            requestRaise();
        }
    });
}

// 1.9.0 で映像モードの既定を「シンプル」から「軽量」に変えた。1.8.x 以前から更新した人で、映像モードを
// 保存していない（既定のまま使っていた）人は、黙って表示が変わらないよう「シンプル」を保存しておく。
// 新しく入れた人だけが既定の「軽量」になる
/** @param {{ reason: string, previousVersion?: string }} details */
async function keepScreenModeOnUpdate(details) {
    if (details.reason !== 'update' || !details.previousVersion) return;
    const [major, minor] = details.previousVersion.split('.').map(Number);
    if (major > 1 || (major === 1 && minor >= 9)) return;
    const v = await chrome.storage.local.get('screenmode');
    if (v.screenmode === undefined) await chrome.storage.local.set({ screenmode: '1' });
}
chrome.runtime.onInstalled.addListener((details) => {
    keepScreenModeOnUpdate(details).catch(() => { });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'RAISE_POPUPS') {
        // 別窓の中（中の枠を含む）からの依頼は無視する（クリックした別窓の上に他の別窓が来てしまうため）
        if (isOurPopupTab(sender.tab)) return;
        requestRaise();
        return;
    }
    if (msg.type === 'COUNT_POPUPS') {
        // 多窓で新しい窓を開く位置をずらすため、いま開いている別窓の数を返す
        getOurPopups().then((ws) => sendResponse(ws.length)).catch(() => sendResponse(null));
        return true; // 非同期で応答する
    }
});
