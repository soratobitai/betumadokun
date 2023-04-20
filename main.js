// デフォルト値
let screenmode = '1';
let window_w = 500;
let window_h = window_w * (9 / 16);
let addedNodeLength = 0;

window.addEventListener('load', function () {

    insertPopupButton();


    /**
     * 番組要素が追加されたかどうかを監視
     */

    // 監視対象の要素の親ノード
    const parentNode = document.body;

    // MutationObserverを作成
    const observer = new MutationObserver((mutations) => {

        addedNodeLength = 0;

        // 追加された要素ごとにループ
        mutations.forEach((mutation) => {
            // 追加されたノードが要素の場合のみ実行
            if (mutation.addedNodes.length && mutation.addedNodes[0].nodeType === Node.ELEMENT_NODE) {
                // 追加された要素の子孫要素すべてのクラス名を取得
                const classNames = Array.from(mutation.addedNodes[0].querySelectorAll('*')).reduce((result, node) => {
                    if (node.className && node.className.trim) {
                        result.push(node.className.trim());
                    }
                    return result;
                }, []);

                // クラス名に指定したテキストが含まれている場合に限り関数を実行
                if (classNames.some(className => /program-card_/.test(className))) {
                    // 追加された要素をカウント
                    addedNodeLength += 1;
                }
            }
        });
    });

    // MutationObserverを開始
    observer.observe(parentNode, { childList: true, subtree: true });


    // 定期的に追加された要素がないかチェック
    setInterval(function () {
        if (addedNodeLength > 0) {
            insertPopupButton();
        }
    }, 1000);

});


async function insertPopupButton() {

    // 保存されている値を取得
    let options = await chrome.storage.local.get();
    if (options) {
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

    // 一旦すべてのボタンを取り除く
    const nicolive_link_buttons_ = document.getElementsByClassName('nicolive_link_button_wrap');
    while (nicolive_link_buttons_.length > 0) {
        nicolive_link_buttons_[0].parentNode.removeChild(nicolive_link_buttons_[0]);
    }

    // すべての番組に別ウィンドウで開くボタンを設置
    for (let i = 0; i < programCards.snapshotLength; i++) {

        let thisElem = programCards.snapshotItem(i);

        let liveLinks = thisElem.querySelectorAll('a');
        if (liveLinks.length !== 0 &&  liveLinks[0].href) {
            let liveUrl = liveLinks[0].href;
            let linkButton = `<div class="nicolive_link_button_wrap"><div class="nicolive_link_button" liveUrl="${liveUrl}"><img src="${chrome.runtime.getURL('images/link.png')}"></div></div>`;

            liveLinks[0].style.position = 'relative';
            liveLinks[0].insertAdjacentHTML("beforeend", linkButton);
        }
    }

    /**
     * ボタンクリック時イベント
     */
    const nicolive_link_buttons = document.getElementsByClassName('nicolive_link_button');

    for (let i = 0; i < nicolive_link_buttons.length; i++) {
        nicolive_link_buttons[i].addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            let liveUrl = e.target.getAttribute("liveUrl");

            if (screenmode === '1' || screenmode === '2') {
                window.open(`${liveUrl}?&popup=on&screenmode=${screenmode}`, '_blank', `width=${window_w},height=${window_h},resizable=yes,location=no,toolbar=no,menubar=no`);
            }
            if (screenmode === '3') {
                window.open(`${liveUrl}`);
            }

        }, false);
    }
}