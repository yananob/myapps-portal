/**
 * Jules API クライアントライブラリ
 *
 * このファイルは、Jules API（jules.googleapis.com）へのリクエストを抽象化します。
 * すべてのコードコメントは、AGENTS.mdの指示に基づき日本語で記述されています。
 */

export interface JulesSource {
  name: string; // 例: "sources/github/owner/repo"
  id: string;   // 例: "github/owner/repo"
  githubRepo?: {
    owner: string;
    repo: string;
  };
}

export interface CreateSessionRequest {
  prompt: string;
  sourceContext: {
    source: string;
    githubRepoContext?: {
      startingBranch?: string;
    };
  };
  automationMode?: "AUTO_CREATE_PR" | "NO_PR";
  title?: string;
}

export interface JulesSession {
  name: string; // 例: "sessions/31415926535897932384"
  id: string;
  title: string;
  prompt: string;
  sourceContext: {
    source: string;
    githubRepoContext?: {
      startingBranch?: string;
    };
  };
  createTime?: string; // ISO 8601 文字列 (例: "2026-09-01T10:00:00Z")
  create_time?: string; // スネークケースで返却される場合のフォールバック
}

/**
 * APIキーをログ出力用に安全にマスクします。
 */
function maskApiKey(apiKey: string): string {
  if (!apiKey) return "(empty)";
  if (apiKey.length <= 8) return "***";
  return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
}

/**
 * Jules API に接続されているすべてのソース（リポジトリ）の一覧を取得します。
 * ページネーションを自動的に処理して全件取得します。
 *
 * @param apiKey Jules API キー
 * @returns 取得されたソースの配列
 */
export async function listAllJulesSources(apiKey: string): Promise<JulesSource[]> {
  let sources: JulesSource[] = [];
  let pageToken = "";

  console.log(`[JulesClient] Jules ソース一覧の取得を開始します... (ApiKey: ${maskApiKey(apiKey)})`);

  do {
    const url = new URL("https://jules.googleapis.com/v1alpha/sources");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    console.log(`[JulesClient] GET Request -> ${url.toString()}`);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[JulesClient] Jules API ソース一覧の取得に失敗しました: Status=${res.status} ${res.statusText}, URL=${url.toString()}, Response=${errText}`);
      throw new Error(`Jules API ソース一覧の取得に失敗しました: ${res.status} ${res.statusText} - ${errText}`);
    }

    const data = await res.json();
    console.log(`[JulesClient] GET Response <- ${res.status} ${res.statusText}, SourcesCount=${data.sources?.length || 0}, NextPageToken=${data.nextPageToken || "none"}`);

    if (data.sources) {
      sources = sources.concat(data.sources);
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  console.log(`[JulesClient] Jules ソース一覧の取得に成功しました。合計: ${sources.length}件`);
  return sources;
}

/**
 * Jules API に存在するすべてのセッションの一覧を取得します。
 * ページネーションを自動的に処理して全件取得します。
 *
 * @param apiKey Jules API キー
 * @returns 取得されたセッションの配列
 */
export async function listAllJulesSessions(apiKey: string): Promise<JulesSession[]> {
  let sessions: JulesSession[] = [];
  let pageToken = "";

  console.log(`[JulesClient] Jules セッション一覧の取得を開始します... (ApiKey: ${maskApiKey(apiKey)})`);

  do {
    const url = new URL("https://jules.googleapis.com/v1alpha/sessions");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    console.log(`[JulesClient] GET Request -> ${url.toString()}`);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[JulesClient] Jules API セッション一覧の取得に失敗しました: Status=${res.status} ${res.statusText}, URL=${url.toString()}, Response=${errText}`);
      throw new Error(`Jules API セッション一覧の取得に失敗しました: ${res.status} ${res.statusText} - ${errText}`);
    }

    const data = await res.json();
    console.log(`[JulesClient] GET Response <- ${res.status} ${res.statusText}, SessionsCount=${data.sessions?.length || 0}, NextPageToken=${data.nextPageToken || "none"}`);

    if (data.sessions) {
      sessions = sessions.concat(data.sessions);
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  console.log(`[JulesClient] Jules セッション一覧の取得に成功しました。合計: ${sessions.length}件`);
  return sessions;
}

/**
 * 過去24時間以内に作成されたセッション数を計算し、残りの作成可能セッション数を算出します。
 * Jules は 24時間以内に最大 15 セッションまで作成可能です（ローリング方式）。
 *
 * @param sessions Jules セッションの配列
 * @param maxSessions 24時間以内の最大作成枠 (デフォルト: 15)
 * @param now 現在時刻 (テスト用に差し替え可能、デフォルト: 現在日時)
 * @returns { countIn24Hours: number, remainingCapacity: number } 24時間以内の作成件数と残り作成可能枠
 */
export function getRemainingSessionCapacity(
  sessions: JulesSession[],
  maxSessions = 15,
  now = new Date()
): { countIn24Hours: number; remainingCapacity: number } {
  const twentyFourHoursAgo = now.getTime() - 24 * 60 * 60 * 1000;

  const countIn24Hours = sessions.filter((session) => {
    const timeStr = session.createTime || session.create_time;
    if (!timeStr) return false;
    const createTimeMs = new Date(timeStr).getTime();
    return !isNaN(createTimeMs) && createTimeMs >= twentyFourHoursAgo;
  }).length;

  const remainingCapacity = Math.max(0, maxSessions - countIn24Hours);

  return {
    countIn24Hours,
    remainingCapacity,
  };
}

/**
 * 新しい Jules セッションを作成し、指定のタスクを開始します。
 * automationMode に "AUTO_CREATE_PR" を設定することで、計画、修正、検証、PR作成を自動で行うことができます。
 *
 * @param apiKey Jules API キー
 * @param req セッション作成リクエストパラメータ
 * @returns 作成されたセッション情報
 */
export async function createJulesSession(
  apiKey: string,
  req: CreateSessionRequest
): Promise<JulesSession> {
  const url = "https://jules.googleapis.com/v1alpha/sessions";
  const requestBodyStr = JSON.stringify(req, null, 2);

  console.log(`[JulesClient] Jules セッション作成リクエストを送信します:`);
  console.log(`[JulesClient] POST Request -> ${url} (ApiKey: ${maskApiKey(apiKey)})`);
  console.log(`[JulesClient] Request Body:\n${requestBodyStr}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[JulesClient] Jules セッションの作成に失敗しました: Status=${res.status} ${res.statusText}`);
    console.error(`[JulesClient] Response Body:\n${errText}`);
    console.error(`[JulesClient] Sent Request Payload:\n${requestBodyStr}`);
    throw new Error(`Jules セッションの作成に失敗しました: ${res.status} ${res.statusText} - ${errText}`);
  }

  const responseText = await res.text();
  console.log(`[JulesClient] POST Response <- ${res.status} ${res.statusText}`);
  console.log(`[JulesClient] Response Body:\n${responseText}`);

  const sessionData: JulesSession = JSON.parse(responseText);
  console.log(`[JulesClient] Jules セッションの作成に成功しました: Name=${sessionData.name}, ID=${sessionData.id}`);
  return sessionData;
}
