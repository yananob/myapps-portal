import { NextRequest, NextResponse } from "next/server";
import { executeJulesAutomation } from "@/lib/jules-automation-logic";

/**
 * Jules API 呼び出しによるタスク自動化エンドポイント
 *
 * リクエストをパースし、ビジネスロジックを実行するモジュール（executeJulesAutomation）に
 * 処理を委譲します。すべてのコードコメントは日本語で記述されています。
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 認証チェック
    const authHeader = request.headers.get("Authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Jules API キー & GITHUB_OWNER の確認
    const julesApiKey = process.env.JULES_API_KEY;
    const githubOwner = process.env.GITHUB_OWNER;

    if (!julesApiKey) {
      return NextResponse.json({ error: "JULES_API_KEY is not set" }, { status: 500 });
    }
    if (!githubOwner) {
      return NextResponse.json({ error: "GITHUB_OWNER is not set" }, { status: 500 });
    }

    // 3. リクエストボディおよびPub/Sub等のイベントデータのパース
    let body: any = null;
    try {
      const text = await request.clone().text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // ボディがない、またはパースエラーの場合は無視します
    }

    // dryRunオプション、taskオプション、limitオプションのパース
    let bodyDryRun: boolean | null = null;
    let bodyTask: string | null = null;
    let bodyLimit: number | null = null;

    if (body) {
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

    const urlString = request.url || "http://localhost/api/jules-automation";
    const { searchParams } = new URL(urlString);

    // クエリパラメータの読み込み
    const dryRunQuery = searchParams.get("dryRun");
    const taskQuery = searchParams.get("task");
    const limitQuery = searchParams.get("limit");

    // デフォルトは安全のため dryRun = true
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

    // ビジネスロジックを呼び出し
    const result = await executeJulesAutomation({
      dryRun,
      task,
      limit,
      julesApiKey,
      githubOwner,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Jules automation API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
