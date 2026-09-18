import { NextRequest, NextResponse } from "next/server";
import { executeCleanup } from "@/lib/cleanup-logic";
import { executeJulesAutomation } from "@/lib/jules-automation-logic";

export interface ParsedEventPayload {
  command: string;
  dryRun: boolean;
  task: string;
  limit?: number;
  ignoreCooldown?: boolean;
}

interface RawEventData {
  command?: string;
  dryRun?: boolean;
  task?: string;
  limit?: number;
  ignoreCooldown?: boolean;
}

/**
 * JSオブジェクトからイベント用フィールドを抽出します。
 */
function extractPayloadFromObject(obj: Record<string, any>): RawEventData {
  const result: RawEventData = {};

  if (typeof obj.command !== "undefined") {
    result.command = String(obj.command);
  }
  if (typeof obj.dryRun !== "undefined") {
    result.dryRun = obj.dryRun === true || obj.dryRun === "true";
  }
  if (typeof obj.task !== "undefined") {
    result.task = String(obj.task);
  }
  if (typeof obj.limit !== "undefined") {
    const parsedLimit = Number(obj.limit);
    if (!isNaN(parsedLimit)) {
      result.limit = parsedLimit;
    }
  }
  if (typeof obj.ignoreCooldown !== "undefined") {
    result.ignoreCooldown = obj.ignoreCooldown === true || obj.ignoreCooldown === "true";
  }

  return result;
}

/**
 * リクエストボディおよび Pub/Sub メッセージ (Base64) からパラメータを解読・抽出します。
 */
async function parseRequestBody(request: NextRequest): Promise<RawEventData> {
  try {
    const text = await request.clone().text();
    if (!text) return {};

    const body = JSON.parse(text);
    if (!body || typeof body !== "object") return {};

    let extracted = extractPayloadFromObject(body);

    // Pub/Sub Push サブスクリプションメッセージの場合は data 部をデコードして上書き/追加
    if (body.message?.data) {
      try {
        const decodedData = Buffer.from(body.message.data, "base64").toString("utf-8");
        const parsedData = JSON.parse(decodedData);
        if (parsedData && typeof parsedData === "object") {
          extracted = {
            ...extracted,
            ...extractPayloadFromObject(parsedData),
          };
        }
      } catch {
        // Pub/Sub データデコード失敗時はボディから抽出した値を使用
      }
    }

    return extracted;
  } catch {
    return {};
  }
}

/**
 * リクエストからイベント用パラメータ（command, dryRun, task, limit, ignoreCooldown）を抽出・解析します。
 */
export async function parseEventParams(request: NextRequest): Promise<ParsedEventPayload> {
  const bodyData = await parseRequestBody(request);

  // URLクエリパラメータの読み込み
  const urlString = request.url || "http://localhost/api/events";
  const { searchParams } = new URL(urlString);
  const commandQuery = searchParams.get("command");
  const dryRunQuery = searchParams.get("dryRun");
  const taskQuery = searchParams.get("task");
  const limitQuery = searchParams.get("limit");
  const ignoreCooldownQuery = searchParams.get("ignoreCooldown");

  // command の優先順位: クエリパラメータ > ボディ / Pub/Sub > デフォルト("cleanup")
  const command = commandQuery || bodyData.command || "cleanup";

  // dryRun の優先順位: クエリパラメータ > ボディ / Pub/Sub > デフォルト(true)
  let dryRun = true;
  if (dryRunQuery !== null) {
    dryRun = dryRunQuery !== "false";
  } else if (typeof bodyData.dryRun !== "undefined") {
    dryRun = bodyData.dryRun;
  }

  const task = taskQuery || bodyData.task || "all";

  let limit: number | undefined = undefined;
  if (limitQuery !== null) {
    const rawLimit = Number(limitQuery);
    if (!isNaN(rawLimit)) limit = rawLimit;
  } else if (typeof bodyData.limit !== "undefined") {
    limit = bodyData.limit;
  }

  let ignoreCooldown: boolean | undefined = undefined;
  if (ignoreCooldownQuery !== null) {
    ignoreCooldown = ignoreCooldownQuery === "true";
  } else if (typeof bodyData.ignoreCooldown !== "undefined") {
    ignoreCooldown = bodyData.ignoreCooldown;
  }

  return { command, dryRun, task, limit, ignoreCooldown };
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
      } catch {
        // 無効なURLの場合は無視
      }
    }
    if (referer) {
      try {
        if (new URL(referer).host === host) {
          return { authorized: true };
        }
      } catch {
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
    const { command, dryRun, task, limit, ignoreCooldown } = await parseEventParams(request);

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
        ignoreCooldown,
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
