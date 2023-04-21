document.addEventListener('DOMContentLoaded', async function () {

    // デフォルト値
    let windowmode = '2';
    let screenmode = '1';
    let window_w = 500;
    let window_h = Math.round((window_w * (9 / 16)) * 10) / 10;

    // 保存されている値を取得
    let options = await chrome.storage.local.get();
    if (options) {
        windowmode = options['windowmode'] || windowmode;
        screenmode = options['screenmode'] || screenmode;
        window_w = options['window_w'] || window_w;
        window_h = options['window_h'] || Math.round((window_w * (9 / 16)) * 10) / 10;
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
    const windowmodes = document.getElementsByName('windowmode');

    // 保存されている値を設定
    for (let i = 0; i < windowmodes.length; i++) {
        if (windowmodes[i].value === windowmode) {
            windowmodes[i].checked = true;
            break;
        }
    }

    // 変更があれば保存
    for (let i = 0; i < windowmodes.length; i++) {
        windowmodes[i].addEventListener('change', async function () {
            saveOptions(
                null,
                null,
                null,
                null
            );
        });
    }

    /**
     * 映像モード
     */

    // 表示タイプ設定のInput要素の取得
    const screenmodes = document.getElementsByName('screenmode');

    // 保存されている値を設定
    for (let i = 0; i < screenmodes.length; i++) {
        if (screenmodes[i].value === screenmode) {
            screenmodes[i].checked = true;
            break;
        }
    }

    // 変更があれば保存
    for (let i = 0; i < screenmodes.length; i++) {
        screenmodes[i].addEventListener('change', async function () {
            saveOptions(
                null,
                null,
                null,
                null
            );
        });
    }

    /**
     * 別窓サイズ
     */

    // 別窓ウィンドウサイズのInput要素の取得
    const window_w_elem = document.getElementsByName('window_w')[0];
    const window_h_elem = document.getElementsByName('window_h')[0];

    // 保存されている値を設定
    window_w_elem.value = window_w;
    window_h_elem.value = window_h;

    // 変更があれば保存
    window_w_elem.addEventListener('blur', async function (e) {
        const value = convertInt(e.target.value, window_w);
        
        window_w_elem.value = value;

        saveOptions(
            null,
            null,
            value,
            null
        );
    });
    window_h_elem.addEventListener('blur', async function (e) {
        const value = convertInt(e.target.value, window_h);

        window_h_elem.value = value;

        saveOptions(
            null,
            null,
            null,
            value
        );
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

    /**
     * アスペクト比設定ボタン
     */
    setButton.addEventListener('click', async function () {

        const options = await chrome.storage.local.get();
        const window_h = Math.round((options['window_w'] * (9 / 16)) * 10) / 10;

        window_h_elem.value = window_h;

        saveOptions(
            null,
            null,
            null,
            window_h
        );

    });

});

async function saveOptions(windowmode, screenmode, window_w, window_h) {
    const options = {
        'windowmode': windowmode ? windowmode : document.querySelector('input[name="windowmode"]:checked').value,
        'screenmode': screenmode ? screenmode : document.querySelector('input[name="screenmode"]:checked').value,
        'window_w': window_w ? window_w : document.querySelector('input[name="window_w"]').value,
        'window_h': window_h ? window_h : document.querySelector('input[name="window_h"]').value,
    };

    await chrome.storage.local.set(options);
}