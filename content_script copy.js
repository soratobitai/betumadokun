window.addEventListener('load', function () {


    const videoElem = document.evaluate(
        '//div[contains(@class, \'player-display-screen\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);


    const watchPageElem = document.evaluate(
        '//*[@id=\'watchPage\']',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);


    const videoFooterElem = document.evaluate(
        '//div[contains(@class, \'player-display-footer\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);


    videoElem.addEventListener('click', function () {
        if (watchPageElem.style.display === "none") {
            watchPageElem.style.display = "block";
            videoFooterElem.parentNode.insertBefore(videoElem, videoFooterElem);
            //watchPageElem.nextElementSibling.remove();
        } else {
            watchPageElem.style.display = "none";
            watchPageElem.parentNode.insertBefore(videoElem, watchPageElem.nextSibling);
            //bodyElem.appendChild(videoElem);
        }
        
    }, false);

});
