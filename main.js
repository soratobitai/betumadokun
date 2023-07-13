// デフォルト値
let windowmode = '2';
let screenmode = '1';
let window_w = 500;
let window_h = Math.round((window_w * (9 / 16)) * 10) / 10;
let addedNodeLength = 0;

window.addEventListener('load', async function () {

    // 設定を取得
    let options = await chrome.storage.local.get();
    if (options) {
        windowmode = options['windowmode'] || windowmode;
        screenmode = options['screenmode'] || screenmode;
        window_w = options['window_w'] || window_w;
        window_h = options['window_h'] || window_w * (9 / 16);
    }

    // 番組要素リストを取得
    const programCards = document.evaluate(
        '//*[contains(@class, \'program-card_\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    );
    for (let i = 0; i < programCards.snapshotLength; i++) {
        insertPopupButton(programCards.snapshotItem(i));
    }

    /**
     * 番組要素が追加されたかどうかを監視
     */

    // 監視対象の要素の親ノード
    const parentNode = document.body;

    // MutationObserverを作成
    const observer = new MutationObserver(async function (mutations) {
        
        mutations.forEach(function (mutation) {

            // 追加された要素を取得する
            const newNodes = mutation.addedNodes;

            const programCards_ = Array.from(newNodes).reduce((accumulator, node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const matchingElements = Array.from(node.querySelectorAll('[class*="program-card_"]'));
                    accumulator.push(...matchingElements);
                }
                return accumulator;
            }, []);

            // ボタンを追加
            for (let i = 0; i < programCards_.length; i++) {
                insertPopupButton(programCards_[i]);
            }
        });
    });

    // MutationObserverを開始
    observer.observe(parentNode, { childList: true, subtree: true });
});


async function insertPopupButton(targetElem) {

    // 機能拡張が有効か無効かをチェック
    try {
        if (!chrome.runtime.getManifest()) return;
    } catch (error) {
        return;
    }

    // 挿入先
    let liveLink = targetElem.querySelector('a');
    if (!liveLink) return;

    // 挿入要素
    let liveUrl = liveLink.href;
    let linkButton = `<div class="nicolive_link_button_wrap"><div class="nicolive_link_button" liveUrl="${liveUrl}"><img src="${chrome.runtime.getURL('images/link.png')}"></div></div>`;

    // img要素がない or ボタンが既にある場合はスルー
    const imgElement = liveLink.querySelector('img');
    const nicolive_link_button = liveLink.querySelector('.nicolive_link_button');
    if (!imgElement || nicolive_link_button) return;

    // img要素の直後に挿入
    imgElement.insertAdjacentHTML('afterend', linkButton);

    // フレームがある場合は位置をズラす
    const nicoadFrame = targetElem.querySelector('[class*="nicoad-frame"]');
    if (nicoadFrame) {
        const nicolive_link_button_wrap = liveLink.querySelector('.nicolive_link_button_wrap');
        if (nicolive_link_button_wrap) {
            nicolive_link_button_wrap.style.top = '30px';
        }
    }

    // ランキングページの場合　relative
    const programCardRank = targetElem.querySelector('[class*="program-card-rank"]');
    if (programCardRank) {
        liveLink.style.position = 'relative';
    }

    /**
     * ボタンクリック時イベント
     */
    targetElem.querySelector('.nicolive_link_button').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const liveUrl = e.target.getAttribute("liveUrl");

        // シングル
        if (windowmode === '1') {
            window.open(`${liveUrl}?&popup=on&screenmode=${screenmode}`, null, `width=${window_w},height=${window_h},resizable=yes,location=no,toolbar=no,menubar=no`);
        }
        // 多窓
        if (windowmode === '2') {
            window.open(`${liveUrl}?&popup=on&screenmode=${screenmode}`, '_blank', `width=${window_w},height=${window_h},resizable=yes,location=no,toolbar=no,menubar=no`);
        }
        // タブ
        if (windowmode === '3') {
            window.open(`${liveUrl}`);
        }

    }, false);

    // ホバー時にボタン表示
    targetElem.addEventListener('mouseover', function (e) {
        targetElem.querySelector('.nicolive_link_button')?.classList.add('nicolive_link_button_active');
    });
    targetElem.addEventListener('mouseleave', function (e) {
        targetElem.querySelector('.nicolive_link_button')?.classList.remove('nicolive_link_button_active');
    });
}