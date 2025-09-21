// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;

document.addEventListener('DOMContentLoaded', function () {
    
    if (params.get('popup') === 'on') {
        if (params.get('screenmode') === '1') setSimpleScreen();
        if (params.get('screenmode') === '2') setFullScreen();
    }

    document.getElementById('root').style.opacity = '1';
});

function addHoverAction(playerDisplay, targetElement) {

    targetElement.style.display = 'none';

    // ウィンドウ内全体にホバーした時に表示
    playerDisplay.addEventListener('mouseenter', function () {
        targetElement.style.display = 'flex';
        console.log('hover!');
    });

    // ウィンドウからマウスが離れたときに非表示
    playerDisplay.addEventListener('mouseleave', function () {
        if (!targetElement.matches(':hover')) {
            targetElement.style.display = 'none';
            console.log('none!');
        }
    });

    // targetElementにホバーしたときに非表示にしない
    targetElement.addEventListener('mouseenter', function () {
        targetElement.style.display = 'flex';
        console.log('hover!2');
    });

    // targetElementからマウスが離れたときに非表示
    targetElement.addEventListener('mouseleave', function () {
        if (!playerDisplay.matches(':hover')) {
            targetElement.style.display = 'none';
            console.log('none!2');
        }
    });
}

// クローンや相互同期のロジックは撤去
function volumeSetting(playerDisplay) {
    const volumeSettingEl = document.querySelector('[class*="_volume-setting_"]');
    if (!volumeSettingEl) return;

    // オリジナルを playerDisplay 配下に移設（Reactのイベント委譲範囲内を維持）
    playerDisplay.appendChild(volumeSettingEl);
    volumeSettingEl.classList.add('clonedMuteBtnWrap');

    // 最前面に配置
    volumeSettingEl.style.zIndex = '99999999';

    // ホバーアクションを追加
    addHoverAction(playerDisplay, volumeSettingEl);
}
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

    // 音量設定機能追加
    setTimeout(() => {
        volumeSetting(playerDisplay);
    }, 1000);
}

function setFullScreen() {

    const leoPlayer = document.querySelector('[class*="_leo-player_"]');
    const fullScreenButton = document.querySelector('[class*="fullscreen-button"]');

    leoPlayer.classList.add('minSizeNone');
    fullScreenButton.click();
}