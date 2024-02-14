// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;
const loading = `<div class="loading"><div class="circle"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;

document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('overflowHidden');

    // ローディングを挿入
    if (params.get('popup') === 'on') {
        document.body.insertAdjacentHTML("beforeend", loading);
    };
});

window.addEventListener('load', function () {

    document.getElementById('root').style.opacity = '1';

    if (params.get('popup') !== 'on') {
        document.body.classList.remove('overflowHidden');
        return;
    };
    
    // ローディングを終了
    document.querySelector('.loading').style.display = 'none';

    if (params.get('screenmode') === '1') {
        setSimpleScreen();
    }
    if (params.get('screenmode') === '2') {
        setFullScreen();
    }
});

function setSimpleScreen() {

    const videoElem = document.querySelector('[class*="_player-display_"]');
    const videoScreenElem = document.querySelector('[class*="_player-display-screen_"]');
    const videoFooterElem = document.querySelector('[class*="_player-display-footer_"]');
    // const videoLayerElem = document.querySelector('[class*="_video-layer_"]');

    // フルスクリーン表示
    document.body.classList.add('overflowHidden');
    videoElem.classList.add('fullScreenView');
    videoFooterElem.classList.add('hiddenView');
    videoScreenElem.classList.add('minSizeNone');
}

function setFullScreen() {

    const leoPlayer = document.querySelector('[class*="_leo-player_"]');
    const fullScreenButton = document.querySelector('[class*="fullscreen-button"]');

    leoPlayer.classList.add('minSizeNone');
    fullScreenButton.click();
}