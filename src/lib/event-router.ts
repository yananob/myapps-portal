import { NextRequest, NextResponse } from "next/server";
import { executeCleanup } from "@/lib/cleanup-logic";
import { executeJulesAutomation } from "@/lib/jules-automation-logic";

export interface ParsedEventPayload {
  command: string;
  dryRun: boolean;
  task: string;
  limit?: number;
}

/**
 * リクエストからイベント用パラメータ（command, dryRun, task, limit）を抽出・解析します。
 */
export async function parseEventParams(request: NextRequest): Promise<ParsedEventPayload> {
  let bodyCommand: string | null = null;
  let bodyDryRun: boolean | null = null;
  let bodyTask: string | null = null;
  let bodyLimit: number | null = null;

  try {
    const text = await request.clone().text();
    if (text) {
      const body = JSON.parse(text);
      if (body) {
        if (typeof body.command !== "undefined") {
          bodyCommand = body.command;
        }
        if (typeof body.dryRun !== "undefined") {
          bodyDryRun = body.dryRun === true || body.dryRun === "true";
        }
        if (typeof body.task !== "undefined") {
          bodyTask = body.task;
        }
        if (typeof body.limit !== "undefined") {
          bodyLimit = Number(body.limit);
        }

        // Pub/Subメッセージの場合は data 部をデコードして確認
        if (body.message?.data) {
          try {
            const decodedData = Buffer.from(body.message.data, "base64").toString("utf-8");
            const parsedData = JSON.parse(decodedData);
            if (parsedData) {
              if (parsedData.command) {
                bodyCommand = parsedData.command;
              }
              if (typeof parsedData.dryRun !== "undefined") {
                bodyDryRun = parsedData.dryRun === true || parsedData.dryRun === "true";
              }
              if (parsedData.task) {
                bodyTask = parsedData.task;
              }
              if (typeof parsedData.limit !== "undefined") {
                bodyLimit = Number(parsedData.limit);
              }
            }
          } catch (e) {
            // デコード/パースエラーは無視
          }
        }
      }
    }
  } catch (e) {
    // ボディがない、またはパースエラーの場合は無視
  }

  // URLクエリパラメータの読み込み
  const urlString = request.url || "http://localhost/api/events";
  const { searchParams } = new URL(urlString);
  const commandQuery = searchParams.get("command");
  const dryRunQuery = searchParams.get("dryRun");
  const taskQuery = searchParams.get("task");
  const limitQuery = searchParams.get("limit");

  // commandの優先順位: クエリパラメータ > リクエストボディ / Pub/Subデータ > デフォルト("cleanup")
  const command = commandQuery || bodyCommand || "cleanup";

  // dryRunの優先順位: クエリパラメータ > リクエストボディ / Pub/Subデータ > デフォルト(true)
  let dryRun = true;
  if (dryRunQuery !== null) {
    dryRun = dryRunQuery !== "false";
  } else if (bodyDryRun !== null) {
    dryRun = bodyDryRun;
  }

  const task = taskQuery || bodyTask || "all";

  let limit: number | undefined = undefined;
  const rawLimit = limitQuery !== null ? Number(limitQuery) : bodyLimit;
  if (rawLimit !== null && !isNaN(rawLimit)) {
    limit = rawLimit;
  }

  return { command, dryRun, task, limit };
}

/**
 * リクエストの Bearer トークン認証を行います。
 */
export function verifyEventAuth(request: NextRequest): { authorized: boolean; errorResponse?: NextResponse } {
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { authorized: true };
  }

  // 同一オリジン（ダッシュボード画面）からのリクエストを許可
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return { authorized: true };
  }

  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (host) {
    if (origin) {
      try {
        if (new URL(origin).host === host) {
          return { authorized: true };
        }
      } catch (e) {
        // 無効なURLの場合は無視
      }
    }
    if (referer) {
      try {
        if (new URL(referer).host === host) {
          return { authorized: true };
        }
      } catch (e) {
        // 無効なURLの場合は無視
      }
    }
  }

  // CRON_SECRET が未設定の場合は認証スキップ（開発・互換用）
  if (!cronSecret) {
    return { authorized: true };
  }

  return {
    authorized: false,
    errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}

/**
 * イベントリクエストを受け取り、認証チェック・パラメータ解析・各種タスクへのルーティングを実行します。
 */
export async function handleEventRequest(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. 認証チェック
    const auth = verifyEventAuth(request);
    if (!auth.authorized && auth.errorResponse) {
      return auth.errorResponse;
    }

    // 2. パラメータ解析
    const { command, dryRun, task, limit } = await parseEventParams(request);

    // 3. ルーティングおよび処理のディスパッチ
    if (command === "jules-automation") {
      const julesApiKey = process.env.JULES_API_KEY;
      const githubOwner = process.env.GITHUB_OWNER;

      if (!julesApiKey) {
        return NextResponse.json({ error: "JULES_API_KEY is not set" }, { status: 500 });
      }
      if (!githubOwner) {
        return NextResponse.json({ error: "GITHUB_OWNER is not set" }, { status: 500 });
      }

      console.log(`[Event Router] Jules 自動化タスクを起動します (command: ${command}, dryRun: ${dryRun}, task: ${task}, limit: ${limit ?? "デフォルト"})`);
      const result = await executeJulesAutomation({
        dryRun,
        task,
        limit,
        julesApiKey,
        githubOwner,
      });

      return NextResponse.json(result);
    } else if (command === "cleanup") {
      console.log(`[Event Router] クリーンアップ処理を起動します (command: ${command}, dryRun: ${dryRun})`);
      const result = await executeCleanup({ dryRun });
      return NextResponse.json(result);
    } else {
      return NextResponse.json({ error: `Unknown command: ${command}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Event Router error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
