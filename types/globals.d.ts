// ビルドレス型チェック用の最小アンビエント宣言。
// @types/chrome を依存に加えない方針のため、本拡張が実際に使う chrome API だけを手書きで宣言する。
// この .d.ts は実行時には一切読み込まれず、エディタ/tsc の型検査にのみ使われる。

interface Window {
    /** main.js が別窓から参照できるよう公開しているフォーカス関数 */
    focusOpenedWindows?: () => void;
}

declare namespace chrome {
    namespace runtime {
        /** 拡張同梱リソースの絶対URLを返す */
        function getURL(path: string): string;
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
