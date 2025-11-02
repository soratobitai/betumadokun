// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;

// ローディング画面を表示する関数
function showLoadingScreen() {
    const loadingScreen = document.createElement('div');
    loadingScreen.id = 'customLoadingScreen';
    
    const spinner = document.createElement('div');
    spinner.className = 'loadingSpinner';
    
    loadingScreen.appendChild(spinner);
    document.body.appendChild(loadingScreen);
    
    // スクロールバーを非表示にする
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    
    return loadingScreen;
}

// ローディング画面を非表示にする関数
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('customLoadingScreen');
    if (loadingScreen) {
        loadingScreen.style.opacity = '1';
        loadingScreen.style.transition = 'opacity 0.3s ease-out';
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
            loadingScreen.remove();
            // スクロールバーの設定を元に戻す
            // setSimpleScreenでoverflowHiddenクラスが追加される場合は、そのクラスで制御される
            // そうでない場合は、overflowをリセット
            if (!document.body.classList.contains('overflowHidden')) {
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
            }
        }, 300);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    
    if (params.get('popup') === 'on') {
        // ローディング画面を表示
        showLoadingScreen();
        
        // ページがアイドル状態になってから実行（ブラウザがビジーでなくなるのを待つ）
        const executeWhenIdle = (callback) => {
            if ('requestIdleCallback' in window) {
                // requestIdleCallback をサポートしている場合
                requestIdleCallback(() => {
                    // さらにもう一度 requestIdleCallback を呼ぶことで、より確実にアイドル状態を待つ
                    requestIdleCallback(() => {
                        callback();
                        // スタイル適用後にローディングを非表示
                        hideLoadingScreen();
                    }, { timeout: 2000 });
                }, { timeout: 2000 });
            } else {
                // サポートしていない場合は setTimeout でフォールバック
                setTimeout(() => {
                    callback();
                    // スタイル適用後にローディングを非表示
                    hideLoadingScreen();
                }, 1000);
            }
        };

        if (params.get('screenmode') === '1') {
            executeWhenIdle(setSimpleScreen);
        }
        if (params.get('screenmode') === '2') {
            executeWhenIdle(setFullScreen);
        }
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