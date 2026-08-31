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
 * 環境変数 APP_ENV の値に応じてルートコレクション名を決定します。
 * 'test' の場合は '-test' のサフィックスを付与します。
 *
 * @returns ルートコレクション名
 */
export function getRootCollectionName(): string {
  const appEnv = process.env.APP_ENV;
  if (appEnv === "test") {
    return "myapps-portal-test";
  }
  return "myapps-portal";
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
    const rootCollection = getRootCollectionName();
    const snapshot = await db
      .collection(rootCollection)
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
    console.warn(`Firestoreからの最終実行日時取得に失敗しました。空の履歴として処理を続行します (${getRootCollectionName()}):`, error);
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
    const rootCollection = getRootCollectionName();
    await db
      .collection(rootCollection)
      .doc("jules-history")
      .collection("repos")
      .doc(repo)
      .set({
        repoName: repo,
        lastExecutedAt: new Date(),
      }, { merge: true });
    console.log(`Firestore (${rootCollection}) にリポジトリ ${repo} の最終実行日時を保存しました。`);
  } catch (error) {
    console.error(`Firestoreへの最終実行日時（${repo}）の保存に失敗しました:`, error);
  }
}

/**
 * Firestoreから非表示設定されているリポジトリ一覧を取得します。
 * Firestoreの接続エラーや認証エラーが発生した場合は、空の配列を返して処理を継続します。
 *
 * @returns 非表示設定されているリポジトリ名の配列
 */
export async function getHiddenRepos(): Promise<string[]> {
  const result: string[] = [];
  try {
    const db = getFirestoreClient();
    const rootCollection = getRootCollectionName();
    const snapshot = await db
      .collection(rootCollection)
      .doc("settings")
      .collection("hidden-repos")
      .get();
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.hidden !== false) {
        result.push(doc.id);
      }
    });
  } catch (error) {
    console.warn(`Firestoreからの非表示リポジトリ一覧取得に失敗しました。空のリストとして処理を続行します (${getRootCollectionName()}):`, error);
  }
  return result;
}

/**
 * 指定されたリポジトリの非表示設定をFirestoreに保存します。
 *
 * @param repo リポジトリ名
 * @param hidden 非表示にする場合は true、表示する場合は false
 */
export async function setRepoHidden(repo: string, hidden: boolean): Promise<void> {
  try {
    const db = getFirestoreClient();
    const rootCollection = getRootCollectionName();
    const docRef = db
      .collection(rootCollection)
      .doc("settings")
      .collection("hidden-repos")
      .doc(repo);

    if (hidden) {
      await docRef.set({
        repoName: repo,
        hidden: true,
        updatedAt: new Date(),
      }, { merge: true });
      console.log(`Firestore (${rootCollection}) にリポジトリ ${repo} の非表示設定(hidden=true)を保存しました。`);
    } else {
      await docRef.delete();
      console.log(`Firestore (${rootCollection}) からリポジトリ ${repo} の非表示設定を削除(hidden=false)しました。`);
    }
  } catch (error) {
    console.error(`Firestoreへの非表示設定（${repo}: ${hidden}）の保存に失敗しました:`, error);
  }
}
