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

  do {
    const url = new URL("https://jules.googleapis.com/v1alpha/sources");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Jules API ソース一覧の取得に失敗しました: ${res.status} ${res.statusText} - ${errText}`);
    }

    const data = await res.json();
    if (data.sources) {
      sources = sources.concat(data.sources);
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return sources;
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
    throw new Error(`Jules セッションの作成に失敗しました: ${res.status} ${res.statusText} - ${errText}`);
  }

  return res.json();
}
