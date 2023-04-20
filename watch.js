document.addEventListener('DOMContentLoaded', function () {

    // クエリを取得
    const url = new URL(window.location.href);
    const params = url.searchParams;

    // ボタンリンクから来ていない場合は、終了
    if (params.get('popup') !== 'on') return;

    // ローディングを挿入
    const loading = `<div class="loading"><div class="circle"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;
    document.body.insertAdjacentHTML("beforeend", loading);

});

window.addEventListener('load', function () {

    // クエリを取得
    const url = new URL(window.location.href);
    const params = url.searchParams;

    // ボタンリンクから来ていない場合は、終了
    if (params.get('popup') !== 'on') return;

    // ローディングを終了
    const loadingElements = document.querySelectorAll('.loading');
    loadingElements.forEach(element => {
        element.style.display = 'none';
    });

    if (params.get('screenmode') === '1') {
        setSimpleScreen();
    }
    if (params.get('screenmode') === '2') {
        setFullScreen();
    }
    
});

function setSimpleScreen() {

    const videoElem = document.evaluate(
        '//div[contains(@class, \'_player-display_\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);

    const videoScreenElem = document.evaluate(
        '//div[contains(@class, \'_player-display-screen_\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);

    const videoLayerElem = document.evaluate(
        '//div[contains(@class, \'_video-layer_\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);

    const videoFooterElem = document.evaluate(
        '//div[contains(@class, \'_player-display-footer_\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);

    // フルスクリーン表示
    videoElem.classList.add('fullScreenView');
    videoFooterElem.classList.add('hiddenView');
    document.body.classList.add('overflowHidden');
    videoScreenElem.classList.add('minSizeNone');

    // クリックで切り替え
    // videoLayerElem.addEventListener('click', function (e) {
    //     e.preventDefault();
    //     e.stopPropagation();

    //     if (videoElem.classList.contains("fullScreenView")) {
    //         videoElem.classList.remove('fullScreenView');
    //         videoFooterElem.classList.remove('hiddenView');
    //         document.body.classList.remove('overflowHidden');
    //     } else {
    //         videoElem.classList.add('fullScreenView');
    //         videoFooterElem.classList.add('hiddenView');
    //         document.body.classList.add('overflowHidden');
    //         videoScreenElem.classList.add('minSizeNone');
    //     }
    // }, false);

    // videoLayerElem.click();
}

function setFullScreen() {

    const fullScreenButton = document.evaluate(
        '//button[contains(@class, \'fullscreen-button\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);

    fullScreenButton.click();
}