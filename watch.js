// @ts-check
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
        // callback は Promise を返す場合があり、完了（成否問わず）後に必ずローディングを閉じる
        /** @param {() => any} callback */
        const executeWhenIdle = (callback) => {
            const run = () => {
                Promise.resolve()
                    .then(callback)
                    .catch((e) => console.error('別窓くん:', e))
                    .finally(hideLoadingScreen);
            };
            if ('requestIdleCallback' in window) {
                // さらにもう一度 requestIdleCallback を呼ぶことで、より確実にアイドル状態を待つ
                requestIdleCallback(() => requestIdleCallback(run, { timeout: 2000 }), { timeout: 2000 });
            } else {
                // サポートしていない場合は setTimeout でフォールバック
                setTimeout(run, 1000);
            }
        };

        if (params.get('screenmode') === '1') {
            executeWhenIdle(setSimpleScreen);
        }
        if (params.get('screenmode') === '2') {
            executeWhenIdle(setFullScreen);
        }
    }

    const root = document.getElementById('root');
    if (root) root.style.opacity = '1';
});

// 指定セレクタの要素が現れるまで待つ（最大 retries 回・interval ミリ秒間隔でポーリング）
// ニコ生本体（React）の描画が遅れて要素が未生成のケースに対応する。見つからなければ null を返す
/**
 * @param {string} selector
 * @param {{ retries?: number, interval?: number }} [opts]
 * @returns {Promise<Element|null>}
 */
function waitForElement(selector, { retries = 20, interval = 250 } = {}) {
    return new Promise((resolve) => {
        const existing = document.querySelector(selector);
        if (existing) {
            resolve(existing);
            return;
        }
        let count = 0;
        const timer = setInterval(() => {
            const el = document.querySelector(selector);
            if (el || ++count >= retries) {
                clearInterval(timer);
                resolve(el);
            }
        }, interval);
    });
}

/**
 * @param {HTMLElement} playerDisplay
 * @param {HTMLElement} targetElement
 */
function addHoverAction(playerDisplay, targetElement) {

    targetElement.style.display = 'none';

    // ウィンドウ内全体にホバーした時に表示
    playerDisplay.addEventListener('mouseenter', function () {
        targetElement.style.display = 'flex';
    });

    // ウィンドウからマウスが離れたときに非表示
    playerDisplay.addEventListener('mouseleave', function () {
        if (!targetElement.matches(':hover')) {
            targetElement.style.display = 'none';
        }
    });

    // targetElementにホバーしたときに非表示にしない
    targetElement.addEventListener('mouseenter', function () {
        targetElement.style.display = 'flex';
    });

    // targetElementからマウスが離れたときに非表示
    targetElement.addEventListener('mouseleave', function () {
        if (!playerDisplay.matches(':hover')) {
            targetElement.style.display = 'none';
        }
    });
}

// クローンや相互同期のロジックは撤去
/** @param {HTMLElement} playerDisplay */
function volumeSetting(playerDisplay) {
    if (!playerDisplay) return;
    const volumeSettingEl = /** @type {HTMLElement} */ (document.querySelector('[class*="_volume-setting_"]'));
    if (!volumeSettingEl) return;

    // オリジナルを playerDisplay 配下に移設（Reactのイベント委譲範囲内を維持）
    playerDisplay.appendChild(volumeSettingEl);
    volumeSettingEl.classList.add('clonedMuteBtnWrap');

    // 最前面に配置
    volumeSettingEl.style.zIndex = '99999999';

    // ホバーアクションを追加
    addHoverAction(playerDisplay, volumeSettingEl);
}

// 映像のみの再読み込みボタン（ニコ生の「映像・音声が止まった際に押して下さい」ボタン）を
// 音量ボタンと同様に playerDisplay 配下へ移設し、右下に表示する
/** @param {HTMLElement} playerDisplay */
function reloadSetting(playerDisplay) {
    if (!playerDisplay) return;
    // 素の class="reload-button"（録画リスト更新）とは別。CSSモジュール名 ___reload-button___ を狙う
    const reloadBtn = /** @type {HTMLElement} */ (document.querySelector('[class*="_reload-button_"]'));
    if (!reloadBtn) return;

    // オリジナルを playerDisplay 配下に移設（Reactのイベント委譲範囲内を維持）
    playerDisplay.appendChild(reloadBtn);
    reloadBtn.classList.add('clonedReloadBtnWrap');

    // 最前面に配置
    reloadBtn.style.zIndex = '99999999';

    // ホバーアクションを追加
    addHoverAction(playerDisplay, reloadBtn);
}

// コントロール（音量・リロード）を白い映像でも見やすくするため、
// 画面下部に「下→上」の半透明黒グラデーション（スクリム）を敷く（ホバー時のみ表示）
/** @param {HTMLElement} playerDisplay */
function addControlScrim(playerDisplay) {
    if (!playerDisplay) return;
    const scrim = document.createElement('div');
    scrim.className = 'clonedControlScrim';
    playerDisplay.appendChild(scrim);
    addHoverAction(playerDisplay, scrim);
}

async function setSimpleScreen() {

    // プレイヤー本体が現れるまで待つ（未描画のまま変形して例外になるのを防ぐ）
    const playerDisplay = /** @type {HTMLElement} */ (await waitForElement('[class*="_player-display_"]'));
    if (!playerDisplay) return; // 見つからなければ変形しない（素の表示のまま）

    const playerDisplayScreen = document.querySelector('[class*="_player-display-screen_"]');
    const playerDisplayFooter = document.querySelector('[class*="_player-display-footer_"]');
    const commonHeader = document.querySelector('[class*="_common-header_"]');

    document.body.classList.add('overflowHidden');
    playerDisplay.classList.add('fullScreenView');
    playerDisplayScreen?.classList.add('minSizeNone');
    playerDisplayFooter?.classList.add('hiddenView');
    commonHeader?.classList.add('hiddenView');

    // スクリム・音量設定・リロードボタンを追加
    setTimeout(() => {
        addControlScrim(playerDisplay);
        volumeSetting(playerDisplay);
        reloadSetting(playerDisplay);
    }, 1000);
}

async function setFullScreen() {

    const leoPlayer = await waitForElement('[class*="_leo-player_"]');
    const fullScreenButton = /** @type {HTMLElement} */ (await waitForElement('[class*="fullscreen-button"]'));
    if (!leoPlayer || !fullScreenButton) return; // 見つからなければ何もしない

    leoPlayer.classList.add('minSizeNone');
    fullScreenButton.click();
}