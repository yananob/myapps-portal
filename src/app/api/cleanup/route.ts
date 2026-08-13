import { NextRequest, NextResponse } from "next/server";
import { executeCleanup } from "@/lib/cleanup-logic";
import { executeJulesAutomation } from "@/lib/jules-automation-logic";

/**
 * 共通バッチ起動エンドポイント
 *
 * Pub/Sub や cron などのトリガーを受け取り、起動パラメータ（command）に基づいて
 * クリーンアップ処理またはJules自動化処理を使い分けて実行します。
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 認証チェック
    const authHeader = request.headers.get("Authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. リクエストボディの読み込みとパース
    let body: any = null;
    try {
      const text = await request.clone().text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // ボディがない、またはパースエラーの場合は無視
    }

    // 各パラメータ（起動、ドライラン、タスク、制限）の取得
    let bodyCommand: string | null = null;
    let bodyDryRun: boolean | null = null;
    let bodyTask: string | null = null;
    let bodyLimit: number | null = null;

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

    // URLクエリパラメータの読み込み
    const urlString = request.url || "http://localhost/api/cleanup";
    const { searchParams } = new URL(urlString);
    const commandQuery = searchParams.get("command");
    const dryRunQuery = searchParams.get("dryRun");
    const taskQuery = searchParams.get("task");
    const limitQuery = searchParams.get("limit");

    // デフォルト値の決定
    // commandの優先順位: クエリパラメータ > リクエストボディ / Pub/Subデータ > デフォルト("cleanup")
    const command = commandQuery || bodyCommand || "cleanup";

    // dryRunの優先順位: クエリパラメータ > リクエストボディ / Pub/Subデータ > デフォルト(true)
    let dryRun = true;
    if (dryRunQuery !== null) {
      dryRun = dryRunQuery !== "false";
    } else if (bodyDryRun !== null) {
      dryRun = bodyDryRun;
    }

    // コマンドに応じたディスパッチ処理
    if (command === "jules-automation") {
      // Jules API キー & GITHUB_OWNER の確認
      const julesApiKey = process.env.JULES_API_KEY;
      const githubOwner = process.env.GITHUB_OWNER;

      if (!julesApiKey) {
        return NextResponse.json({ error: "JULES_API_KEY is not set" }, { status: 500 });
      }
      if (!githubOwner) {
        return NextResponse.json({ error: "GITHUB_OWNER is not set" }, { status: 500 });
      }

      const task = taskQuery || bodyTask || "all";
      let limit: number | undefined = undefined;
      const rawLimit = limitQuery !== null ? Number(limitQuery) : bodyLimit;
      if (rawLimit !== null && !isNaN(rawLimit)) {
        limit = rawLimit;
      }

      console.log(`[Batch Dispatch] Jules 自動化タスクを起動します (command: ${command}, dryRun: ${dryRun}, task: ${task}, limit: ${limit ?? "デフォルト"})`);
      const result = await executeJulesAutomation({
        dryRun,
        task,
        limit,
        julesApiKey,
        githubOwner,
      });

      return NextResponse.json(result);
    } else {
      // デフォルト: クリーンアップ処理
      console.log(`[Batch Dispatch] クリーンアップ処理を起動します (command: ${command}, dryRun: ${dryRun})`);
      const result = await executeCleanup({ dryRun });
      return NextResponse.json(result);
    }
  } catch (error: any) {
    console.error("Batch Dispatch API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
