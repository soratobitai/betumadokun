// @ts-check

// 「別窓を常に手前に表示」の前面化を担う Service Worker。
// Web の window.focus() は複数の別窓を同時に手前へ保てず（OSのアクティブ窓は1つ）、
// 本ページ移動後に再取得した別窓は上げにくい。拡張特権の chrome.windows.update なら
// opener 関係・ユーザー操作の有無に関わらず任意の窓を前面化できるため、そちらへ委譲する。

const POPUP_URL_RE = /^https:\/\/live\.nicovideo\.jp\/watch\/lv\d+/;

// 我々が開いた別窓か判定する（ポップアップ型 ＋ 視聴URL ＋ popup=on マーカー）。
// popup=on は content script が別窓を開くときだけ付与するので、手動で開いた視聴ページと区別できる。
/**
 * @param {chrome.windows.Window} win
 * @returns {boolean}
 */
function isOurPopup(win) {
    if (!win || win.type !== 'popup' || !Array.isArray(win.tabs) || win.tabs.length !== 1) return false;
    const url = win.tabs[0].url || win.tabs[0].pendingUrl || '';
    return POPUP_URL_RE.test(url) && url.indexOf('popup=on') !== -1;
}

// 全別窓を古い順→新しい順に前面化する（最後に前面化した最新窓が最前面に来る）。
async function raisePopups() {
    /** @type {chrome.windows.Window[]} */
    let wins;
    try {
        wins = await chrome.windows.getAll({ populate: true });
    } catch (e) {
        return;
    }
    const ours = wins.filter(isOurPopup).sort((a, b) => a.id - b.id); // id昇順 ≒ 生成順
    for (const w of ours) {
        try {
            await chrome.windows.update(w.id, { focused: true });
        } catch (e) {
            // 閉じられている等は無視
        }
    }
}

chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'RAISE_POPUPS') raisePopups();
});
