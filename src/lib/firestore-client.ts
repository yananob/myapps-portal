import { Firestore } from "@google-cloud/firestore";

let firestore: Firestore | null = null;

/**
 * Firestore クライアントを取得します。
 *
 * すべてのコードコメントは、AGENTS.mdの指示に基づき日本語で記述されています。
 */
export function getFirestoreClient(): Firestore {
  if (!firestore) {
    const projectId = process.env.GCP_PROJECT_ID;
    if (projectId) {
      firestore = new Firestore({ projectId });
    } else {
      firestore = new Firestore();
    }
  }
  return firestore;
}

/**
 * すべての子リポジトリの最終実行日時を取得します。
 * Firestoreの接続エラーや認証エラーが発生した場合は、空のオブジェクトを返して処理を継続します。
 *
 * @returns リポジトリ名をキー、最終実行日時を値とするオブジェクト
 */
export async function getRepoLastExecutedTimes(): Promise<Record<string, Date>> {
  const result: Record<string, Date> = {};
  try {
    const db = getFirestoreClient();
    const snapshot = await db
      .collection("myapps-portal")
      .doc("jules-history")
      .collection("repos")
      .get();
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Firestoreの Timestamp から Date オブジェクトへ変換
      const lastExecutedAt = data.lastExecutedAt?.toDate?.() || (data.lastExecutedAt ? new Date(data.lastExecutedAt) : new Date(0));
      result[doc.id] = lastExecutedAt;
    });
  } catch (error) {
    console.warn("Firestoreからの最終実行日時取得に失敗しました。空の履歴として処理を続行します:", error);
  }
  return result;
}

/**
 * 指定されたリポジトリの最終実行日時を現在時刻に更新します。
 *
 * @param repo リポジトリ名
 */
export async function updateRepoLastExecutedTime(repo: string): Promise<void> {
  try {
    const db = getFirestoreClient();
    await db
      .collection("myapps-portal")
      .doc("jules-history")
      .collection("repos")
      .doc(repo)
      .set({
        repoName: repo,
        lastExecutedAt: new Date(),
      }, { merge: true });
    console.log(`Firestoreにリポジトリ ${repo} の最終実行日時を保存しました。`);
  } catch (error) {
    console.error(`Firestoreへの最終実行日時（${repo}）の保存に失敗しました:`, error);
  }
}
