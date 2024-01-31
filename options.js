document.addEventListener('DOMContentLoaded', async function () {

    // デフォルト値
    let windowmode = '2';
    let screenmode = '1';
    let window_w = 500;
    let window_h = Math.round((window_w * (9 / 16)) * 10) / 10;

    // 保存されている値を取得
    let options = await chrome.storage.local.get();

    if (options) {
        if (options.windowmode === undefined) options.windowmode = windowmode;
        if (options.screenmode === undefined) options.screenmode = screenmode;
        if (options.window_w === undefined) options.window_w = window_w;
        if (options.window_h === undefined) options.window_h = window_h;
    } else {
        options = {
            'windowmode': windowmode,
            'screenmode': screenmode,
            'window_w': window_w,
            'window_h': window_h
        };
    }

    /**
     * 別窓モード
     */

    // 別窓モード設定のInput要素の取得
    document.getElementsByName('windowmode').forEach(item => {
        if (item.value === options.windowmode) {
            item.checked = true;
        } else {
            item.checked = false;
        }
    });

    /**
     * 映像モード
     */

    // 表示タイプ設定のInput要素の取得
    document.getElementsByName('screenmode').forEach(item => {
        if (item.value === options.screenmode) {
            item.checked = true;
        } else {
            item.checked = false;
        }
    });

    /**
     * 別窓サイズ
     */

    // 別窓ウィンドウサイズのInput要素の取得
    const window_w_elem = document.getElementsByName('window_w')[0];
    const window_h_elem = document.getElementsByName('window_h')[0];

    // 保存されている値を設定
    window_w_elem.value = options.window_w;
    window_h_elem.value = options.window_h;

    // 変更があれば保存
    window_w_elem.addEventListener('blur', async function (e) {
        window_w_elem.value = convertInt(e.target.value, options.window_w);
        saveOptions();
    });
    window_h_elem.addEventListener('blur', async function (e) {
        window_h_elem.value = convertInt(e.target.value, options.window_h);
        saveOptions();
    });

    /**
     * アスペクト比設定ボタン
     */
    setButton.addEventListener('click', async function () {

        const window_w_ = document.querySelector('input[name="window_w"]').value;
        const window_h = Math.round((window_w_ * (9 / 16)) * 10) / 10;

        window_h_elem.value = window_h;
        saveOptions();
    });

    // フォームに変更があったら保存する
    document.getElementById('optionForm').addEventListener('change', function (event) {
        saveOptions();
    });

    async function saveOptions() {
        
        options.windowmode = document.querySelector('input[name="windowmode"]:checked').value;
        options.screenmode = document.querySelector('input[name="screenmode"]:checked').value;
        options.window_w = document.querySelector('input[name="window_w"]').value;
        options.window_h = document.querySelector('input[name="window_h"]').value;

        await chrome.storage.local.set(options);

        console.log('saveOptions:', options);
    }
});

// 数量フォームを監視　強制的に数値に変換
function convertInt(value, defaultVal) {

    // 全角を半角に変換
    value = value.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) {
        return String.fromCharCode(s.charCodeAt(0) - 65248);
    }).replace(/[^\u0000-\u007E]/g, "");

    // 数値に変換
    let value_ = parseInt(value, 10);

    // 数値でなければデフォルト値を返す
    if (isNaN(value_)) {
        return defaultVal;
    }
    // 整数でなければデフォルト値を返す
    if (!Number.isInteger(value_)) {
        return defaultVal;
    }
    // 正数でなければデフォルト値を返す
    if (value_ <= 0) {
        return defaultVal;
    }
    return value_;
}