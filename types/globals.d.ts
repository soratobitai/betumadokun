// ビルドレス型チェック用の最小アンビエント宣言。
// @types/chrome を依存に加えない方針のため、本拡張が実際に使う chrome API だけを手書きで宣言する。
// この .d.ts は実行時には一切読み込まれず、エディタ/tsc の型検査にのみ使われる。

interface Window {
    /** main.js が別窓から参照できるよう公開しているフォーカス関数 */
    focusOpenedWindows?: () => void;
}

/**
 * lib/hls.min.js（UMD）が content script の global に定義する hls.js。
 * 軽量モード（lite.js）が使う分だけ宣言する。
 */
declare class Hls {
    constructor(config?: Record<string, any>);
    static isSupported(): boolean;
    static readonly Events: { MANIFEST_PARSED: string; ERROR: string };
    static readonly ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
    /** 画質一覧（ビットレート昇順） */
    readonly levels: { width: number; height: number; bitrate: number }[];
    /** 自動画質選択の上限（levels の添字。-1 で上限なし） */
    autoLevelCapping: number;
    /** 最初に読む画質（levels の添字。-1 で自動） */
    startLevel: number;
    /** autoStartLoad: false のときに読み込みを始める */
    startLoad(startPosition?: number): void;
    /** 再生位置の時刻（プレイリストの PROGRAM-DATE-TIME 由来。無ければ null） */
    readonly playingDate: Date | null;
    /** ライブの最新位置からの遅れ（秒） */
    readonly latency: number;
    loadSource(url: string): void;
    attachMedia(media: HTMLMediaElement): void;
    recoverMediaError(): void;
    destroy(): void;
    on(event: string, listener: (event: string, data: any) => void): void;
}

declare namespace chrome {
    namespace runtime {
        /** 拡張同梱リソースの絶対URLを返す */
        function getURL(path: string): string;

        /** manifest.json の内容（使う項目だけ宣言） */
        function getManifest(): { version: string };

        /** 直近の拡張API呼び出しのエラー（無ければ undefined） */
        const lastError: { message?: string } | undefined;

        /** 拡張内メッセージ送信（レスポンスコールバックは任意） */
        function sendMessage(message: any, responseCallback?: (response: any) => void): void;

        const onMessage: {
            addListener(
                callback: (
                    message: any,
                    sender: { tab?: { id?: number; windowId?: number; url?: string } },
                    sendResponse: (response?: any) => void
                ) => void | boolean
            ): void;
        };
    }

    namespace windows {
        interface Tab {
            url?: string;
            pendingUrl?: string;
        }
        interface Window {
            id?: number;
            /** 'normal' | 'popup' など */
            type?: string;
            tabs?: Tab[];
        }
        /** 全ウィンドウを取得（populate:true でタブ情報も含む） */
        function getAll(getInfo?: { populate?: boolean }): Promise<Window[]>;
        /** ウィンドウを更新（focused:true で前面化） */
        function update(windowId: number, updateInfo: { focused?: boolean }): Promise<Window>;
    }

    namespace storage {
        interface StorageChange {
            oldValue?: any;
            newValue?: any;
        }

        interface StorageArea {
            /** キー未指定で全アイテムを取得（空なら {}） */
            get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>>;
            /** 指定アイテムを保存 */
            set(items: Record<string, any>): Promise<void>;
        }

        const local: StorageArea;

        const onChanged: {
            addListener(
                callback: (changes: Record<string, StorageChange>, areaName: string) => void
            ): void;
        };
    }
}
