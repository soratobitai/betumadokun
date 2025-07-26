// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;

const muteBtnSvgData = `
  <svg width="200" height="200" viewBox="-50 -50 200 200" xmlns="http://www.w3.org/2000/svg">
    <path d="M24.122,24l21.106,-22.748c1.155,-1.246 2.863,-1.598 4.339,-0.894c1.475,0.705 2.433,2.328 2.433,4.126c0,21.38 0,69.652 0,91.032c0,1.798 -0.958,3.421 -2.433,4.126c-1.476,0.704 -3.184,0.352 -4.339,-0.894l-21.106,-22.748l-16.122,0c-2.122,0 -4.157,-0.843 -5.657,-2.343c-1.5,-1.5 -2.343,-3.535 -2.343,-5.657c0,-9.777 0,-26.223 0,-36c0,-2.122 0.843,-4.157 2.343,-5.657c1.5,-1.5 3.535,-2.343 5.657,-2.343l16.122,0ZM75.486,14.675c0.155,-0.244 0.338,-0.473 0.546,-0.681c0.468,-0.494 0.959,-0.985 1.425,-1.451c1.48,-1.481 3.853,-1.569 5.439,-0.202c10.477,9.178 17.104,22.651 17.104,37.659c0,0 0,0 0,0c0,15.008 -6.627,28.481 -17.112,37.649c-1.582,1.363 -3.946,1.275 -5.422,-0.201c-0.299,-0.288 -0.604,-0.589 -0.909,-0.893c-0.18,-0.178 -0.36,-0.358 -0.538,-0.536c-0.787,-0.787 -1.21,-1.866 -1.169,-2.978c0.042,-1.112 0.545,-2.156 1.388,-2.882c2.768,-2.402 5.201,-5.179 7.221,-8.252c0.137,-0.208 0.271,-0.417 0.404,-0.628c0.148,-0.234 0.293,-0.469 0.436,-0.706c0.115,-0.192 0.229,-0.384 0.34,-0.577c0.065,-0.11 0.128,-0.221 0.191,-0.333c0.11,-0.192 0.217,-0.386 0.323,-0.581l0.061,-0.11l0.113,-0.212c0.095,-0.179 0.189,-0.358 0.281,-0.538c0.256,-0.497 0.502,-1.001 0.737,-1.511c0.13,-0.282 0.257,-0.566 0.381,-0.851c0.511,-1.179 0.966,-2.388 1.363,-3.623c0.198,-0.613 0.38,-1.232 0.548,-1.857c0.062,-0.231 0.122,-0.463 0.18,-0.696c0.04,-0.158 0.078,-0.316 0.115,-0.475c0.059,-0.249 0.116,-0.499 0.17,-0.751c0.264,-1.224 0.472,-2.47 0.621,-3.733l0.032,-0.274c0.162,-1.461 0.245,-2.946 0.245,-4.451c0,0 0,0 0,0c0,-10.566 -4.106,-20.181 -10.808,-27.335l-0.112,-0.12l-0.064,-0.067c-0.289,-0.304 -0.583,-0.604 -0.881,-0.9l-0.155,-0.153l-0.119,-0.115c-0.173,-0.168 -0.346,-0.334 -0.522,-0.498c-0.357,-0.335 -0.72,-0.663 -1.09,-0.985c-0.104,-0.09 -0.204,-0.185 -0.298,-0.285c-0.207,-0.219 -0.386,-0.459 -0.537,-0.715c-0.025,-0.043 -0.05,-0.087 -0.073,-0.131l-0.013,-0.023l-0.01,-0.019l-0.013,-0.026l-0.004,-0.007c-0.03,-0.059 -0.058,-0.119 -0.086,-0.179c-0.208,-0.463 -0.328,-0.966 -0.347,-1.484c-0.029,-0.772 0.168,-1.528 0.555,-2.181c0.012,-0.02 0.024,-0.039 0.036,-0.059l0.027,-0.043ZM62.189,27.828c0.363,-0.38 0.73,-0.747 1.079,-1.096c1.427,-1.427 3.693,-1.568 5.286,-0.329c0.879,0.697 1.719,1.441 2.516,2.229c5.508,5.453 8.93,13.014 8.93,21.368c0,0 0,0 0,0c0,9.562 -4.483,18.084 -11.46,23.579c-0.049,0.039 -0.099,0.076 -0.15,0.112l-0.077,0.053c-0.642,0.431 -1.375,0.654 -2.11,0.673l-0.089,0.001c-1.029,0.005 -2.055,-0.389 -2.831,-1.165c-0.307,-0.288 -0.621,-0.595 -0.938,-0.909c-0.178,-0.177 -0.357,-0.356 -0.536,-0.535c-0.184,-0.184 -0.347,-0.383 -0.49,-0.595c-0.036,-0.053 -0.07,-0.107 -0.103,-0.161c-0.02,-0.034 -0.039,-0.067 -0.058,-0.101l-0.018,-0.031l-0.006,-0.01c-0.022,-0.04 -0.043,-0.081 -0.064,-0.122c-0.319,-0.628 -0.469,-1.337 -0.424,-2.055c0.07,-1.144 0.628,-2.203 1.533,-2.908c3.013,-2.301 5.345,-5.445 6.651,-9.077c0.176,-0.489 0.333,-0.987 0.471,-1.493c0.456,-1.675 0.699,-3.437 0.699,-5.256c0,0 0,0 0,0c0,-6.449 -3.059,-12.19 -7.804,-15.848c-0.898,-0.7 -1.453,-1.752 -1.523,-2.888c-0.07,-1.136 0.351,-2.248 1.156,-3.053c0.059,-0.064 0.119,-0.128 0.179,-0.192l0.181,-0.191Z"
      fill="white"/>
  </svg>
`;
const mutedBtnSvgData = `
  <svg width="200" height="200" viewBox="-50 -50 200 200" xmlns="http://www.w3.org/2000/svg">
    <path d="M24.122,24l21.106,-22.748c1.155,-1.246 2.863,-1.598 4.339,-0.894c1.475,0.705 2.433,2.328 2.433,4.126c0,21.38 0,69.652 0,91.032c0,1.798 -0.958,3.421 -2.433,4.126c-1.476,0.704 -3.184,0.352 -4.339,-0.894l-21.106,-22.748l-16.122,0c-2.122,0 -4.157,-0.843 -5.657,-2.343c-1.5,-1.5 -2.343,-3.535 -2.343,-5.657c0,-9.777 0,-26.223 0,-36c0,-2.122 0.843,-4.157 2.343,-5.657c1.5,-1.5 3.535,-2.343 5.657,-2.343l16.122,0ZM80,42.731c0,0 7.186,-7.186 11.454,-11.454c1.703,-1.703 4.464,-1.703 6.168,0c0.364,0.365 0.736,0.737 1.101,1.101c1.703,1.704 1.703,4.465 0,6.168c-4.268,4.268 -11.454,11.454 -11.454,11.454c0,0 7.186,7.186 11.454,11.454c1.703,1.703 1.703,4.464 0,6.168c-0.365,0.364 -0.737,0.736 -1.101,1.101c-1.704,1.703 -4.465,1.703 -6.168,0c-4.268,-4.268 -11.454,-11.454 -11.454,-11.454c0,0 -7.186,7.186 -11.454,11.454c-1.703,1.703 -4.464,1.703 -6.168,0c-0.364,-0.365 -0.736,-0.737 -1.101,-1.101c-1.703,-1.704 -1.703,-4.465 0,-6.168c4.268,-4.268 11.454,-11.454 11.454,-11.454c0,0 -7.186,-7.186 -11.454,-11.454c-1.703,-1.703 -1.703,-4.464 0,-6.168c0.365,-0.364 0.737,-0.736 1.101,-1.101c1.704,-1.703 4.465,-1.703 6.168,0c4.268,4.268 11.454,11.454 11.454,11.454Z"
      fill="white"/>
  </svg>
`;
const muteBtnSvg = `data:image/svg+xml,${encodeURIComponent(muteBtnSvgData)}`;
const mutedBtnSvg = `data:image/svg+xml,${encodeURIComponent(mutedBtnSvgData)}`;


document.addEventListener('DOMContentLoaded', function () {
    
    if (params.get('popup') === 'on') {
        if (params.get('screenmode') === '1') setSimpleScreen();
        if (params.get('screenmode') === '2') setFullScreen();
    }

    document.getElementById('root').style.opacity = '1';
});

function addHoverAction(playerDisplay, clonedElement) {

    clonedElement.style.display = 'none';

    // ウィンドウ内全体にホバーした時にclonedElementを表示
    playerDisplay.addEventListener('mouseenter', function () {
        clonedElement.style.display = 'flex';
        console.log('hover!');
    });

    // ウィンドウからマウスが離れたときにclonedElementを非表示
    playerDisplay.addEventListener('mouseleave', function () {
        // clonedElementにホバー中でない場合は非表示
        if (!clonedElement.matches(':hover')) {
            clonedElement.style.display = 'none';
            console.log('none!');
        }
    });

    // clonedElementにホバーしたときに非表示にしない
    clonedElement.addEventListener('mouseenter', function () {
        clonedElement.style.display = 'flex';
        console.log('hover!2');
    });

    // clonedElementからマウスが離れたときに非表示
    clonedElement.addEventListener('mouseleave', function () {
        // ウィンドウにホバー中でない場合は非表示
        if (!playerDisplay.matches(':hover')) {
            clonedElement.style.display = 'none';
            console.log('none!2');
        }
    });
}

const syncMuteButton = (originalMuteBtn, clonedMuteBtn) => {
    const toggleStateValue = originalMuteBtn.getAttribute('data-toggle-state');
    clonedMuteBtn.style.backgroundImage = `url(${toggleStateValue === 'false' ? muteBtnSvg : mutedBtnSvg})`;
    clonedMuteBtn.setAttribute('aria-label', toggleStateValue === 'false' ? 'ミュート (消音)' : 'ミュート解除');
    clonedMuteBtn.parentElement.querySelector('[class*="_volume-size-control_"]').setAttribute('data-isolated', toggleStateValue);
};

function addMuteBtnAction(originalMuteBtn, clonedMuteBtn) {
    
    if (originalMuteBtn && clonedMuteBtn) {
        let isSyncingMute = false;

        // ミュートボタンのスタイルを指定
        clonedMuteBtn.style.backgroundSize = 'cover';
        clonedMuteBtn.style.backgroundPosition = 'center center';
        syncMuteButton(originalMuteBtn, clonedMuteBtn);

        const syncMuteState = (source, target) => {
            if (!isSyncingMute) {
                isSyncingMute = true;
                target.click();
                isSyncingMute = false;
            }
        };

        originalMuteBtn.addEventListener("click", () => syncMuteState(originalMuteBtn, clonedMuteBtn));
        clonedMuteBtn.addEventListener("click", () => {
            syncMuteState(clonedMuteBtn, originalMuteBtn);
            syncMuteButton(originalMuteBtn, clonedMuteBtn);
        });
    }
}

function addSliderAction(volumeSetting, clonedElement, originalMuteBtn, clonedMuteBtn) {
    const originalSlider = volumeSetting.querySelector("input[type='range']");
    const clonedSlider = clonedElement.querySelector("input[type='range']");

    let isSyncing = false  // フラグを用意

    const updateSliderStyle = (slider) => {
        const sliderValue = slider.parentElement.querySelector('[class*="_value_"]');
        const sliderHandle = slider.parentElement.querySelector('[class*="_handle_"]');

        const percentage = Math.round((slider.value - slider.min) / (slider.max - slider.min) * 100);

        sliderValue.style.marginRight = `${100 - percentage}%`;
        sliderHandle.style.marginLeft = `${percentage}%`;

        slider.parentElement.setAttribute('aria-label', `音量:${percentage}`);
    }

    const syncVolume = (source, target) => {
        if (isSyncing) return;  // ループを防ぐためのガード

        isSyncing = true;  // フラグを立てる

        target.value = source.value;
        target.dispatchEvent(new Event("input", { bubbles: true }));

        updateSliderStyle(source);
        updateSliderStyle(target);
        syncMuteButton(originalMuteBtn, clonedMuteBtn);

        isSyncing = false;  // フラグを解除
    }

    // スライダーのイベントを修正
    if (originalSlider && clonedSlider) {
        originalSlider.addEventListener("input", () => syncVolume(originalSlider, clonedSlider));
        clonedSlider.addEventListener("input", () => syncVolume(clonedSlider, originalSlider));

        // 初期状態のスタイル更新
        updateSliderStyle(originalSlider);
        updateSliderStyle(clonedSlider);
    }
}
function volumeSetting(playerDisplay) {
    const volumeSetting = document.querySelector('[class*="_volume-setting_"]');
    if (!volumeSetting) return;

    // volumeSettingを`importNode` を使って完全コピー
    const clonedElement = document.importNode(volumeSetting, true);
    document.body.appendChild(clonedElement);
    clonedElement.classList.add('clonedMuteBtnWrap');

    const originalMuteBtn = volumeSetting.querySelector('[class*="_mute-button_"]');
    const clonedMuteBtn = clonedElement.querySelector('[class*="_mute-button_"]');

    // ホバーアクションを追加
    addHoverAction(playerDisplay, clonedElement);
    
    // ミュートボタンを同期
    addMuteBtnAction(originalMuteBtn, clonedMuteBtn);

    // 音量スライダーの相互同期
    addSliderAction(volumeSetting, clonedElement, originalMuteBtn, clonedMuteBtn);
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