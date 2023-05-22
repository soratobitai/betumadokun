// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;
const loading = `<div class="loading"><div class="circle"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;

document.addEventListener('DOMContentLoaded', function () {
    // ローディングを挿入
    if (params.get('popup') === 'on') {
        document.body.insertAdjacentHTML("beforeend", loading);
    };
});

window.addEventListener('load', function () {

    root.style.display = 'block';

    if (params.get('popup') === 'on') {

        // ローディングを終了
        document.querySelector('.loading').style.display = 'none';

        if (params.get('screenmode') === '1') {
            setSimpleScreen();
        }
        if (params.get('screenmode') === '2') {
            setFullScreen();
        }
    };
});

function setSimpleScreen() {

    const videoElem = document.evaluate(
        '//div[contains(@class, \'_player-display_\')]',
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
    ).snapshotItem(0);

    const videoScreenElem = document.evaluate(
        '//div[contains(@class, \'_player-display-screen_\')]',
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
    ).snapshotItem(0);

    const videoLayerElem = document.evaluate(
        '//div[contains(@class, \'_video-layer_\')]',
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
    ).snapshotItem(0);

    const videoFooterElem = document.evaluate(
        '//div[contains(@class, \'_player-display-footer_\')]',
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
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
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
    ).snapshotItem(0);

    fullScreenButton.click();
}