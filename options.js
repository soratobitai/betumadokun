document.addEventListener('DOMContentLoaded', async function () {

    // デフォルト値
    let screenmode = '0';
    let window_w = 500;
    let window_h = window_w * (9 / 16);

    // 保存されている値を取得
    let options = await chrome.storage.local.get();
    if (options) {
        screenmode = options['screenmode'] || screenmode;
        window_w = options['window_w'] || window_w;
        window_h = options['window_h'] || window_w * (9 / 16);
    } else {
        options = {
            'screenmode': screenmode,
            'window_w': window_w,
            'window_h': window_h
        };
    }


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
            options.screenmode = document.querySelector('input[name="screenmode"]:checked').value;
            options.window_w = document.querySelector('input[name="window_w"]').value;
            options.window_h = document.querySelector('input[name="window_h"]').value;
            // 保存
            await chrome.storage.local.set(options);
        });
    }


    // 別窓ウィンドウサイズのInput要素の取得
    const window_w_elem = document.getElementsByName('window_w')[0];
    const window_h_elem = document.getElementsByName('window_h')[0];

    // 保存されている値を設定
    window_w_elem.value = window_w;
    window_h_elem.value = window_h;

    // 変更があれば保存
    window_w_elem.addEventListener('blur', async function (e) {
        const name = e.target.name;
        const value = convertInt(e.target.value, window_w);
        
        window_w_elem.value = value;

        options[name] = value;
        options.screenmode = document.querySelector('input[name="screenmode"]:checked').value;
        options.window_h = document.querySelector('input[name="window_h"]').value;
        await chrome.storage.local.set(options);
    });
    window_h_elem.addEventListener('blur', async function (e) {
        const name = e.target.name;
        const value = convertInt(e.target.value, window_h);

        window_h_elem.value = value;

        options[name] = value;
        options.screenmode = document.querySelector('input[name="screenmode"]:checked').value;
        options.window_w = document.querySelector('input[name="window_w"]').value;
        await chrome.storage.local.set(options);
    });

    // 数量フォームを監視　強制的に数値に変換
    function convertInt(value, defaultVal) {
        let value_ = isNaN(value) ? value : parseInt(value, 10);
        value_ = Number(value) ? Number(value) : defaultVal; // 数値かどうか
        value_ = Number.isInteger(value_) ? value_ : defaultVal; // 整数かどうか
        value_ = Math.sign(value_) === 1 ? value_ : defaultVal; // 正数かどうか
        return value_;
    }

    /**
     * アスペクト比設定ボタン
     */
    setButton.addEventListener('click', async function () {

        const options = await chrome.storage.local.get();
        const window_h = Math.round((options['window_w'] * (9 / 16)) * 10) / 10;

        window_h_elem.value = window_h;

        options['window_h'] = window_h;
        options.screenmode = document.querySelector('input[name="screenmode"]:checked').value;
        options.window_w = document.querySelector('input[name="window_w"]').value;
        await chrome.storage.local.set(options);
    });

});

