// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;

document.addEventListener('DOMContentLoaded', function () {
    
    if (params.get('popup') === 'on') {

        if (params.get('screenmode') === '1') {
            setSimpleScreen();
        }

        if (params.get('screenmode') === '2') {
            setFullScreen();
        }
    }

    document.getElementById('root').style.opacity = '1';
});

window.addEventListener('load', function () {
    //
});

function setSimpleScreen() {

    const playerDisplay = document.querySelector('[class*="_player-display_"]');
    const playerDisplayScreen = document.querySelector('[class*="_player-display-screen_"]');
    const playerDisplayFooter = document.querySelector('[class*="_player-display-footer_"]');
    const commonHeader = document.querySelector('[class*="_common-header_"]');

    document.body.classList.add('overflowHidden');
    playerDisplay.classList.add('fullScreenView');
    playerDisplayScreen.classList.add('minSizeNone');
    playerDisplayFooter.classList.add('hiddenView');
    commonHeader.classList.add('hiddenView');
}

function setFullScreen() {

    const leoPlayer = document.querySelector('[class*="_leo-player_"]');
    const fullScreenButton = document.querySelector('[class*="fullscreen-button"]');

    leoPlayer.classList.add('minSizeNone');
    fullScreenButton.click();
}