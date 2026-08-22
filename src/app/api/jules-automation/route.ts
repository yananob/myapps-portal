import { NextRequest, NextResponse } from "next/server";
import { executeJulesAutomation } from "@/lib/jules-automation-logic";
import { verifyEventAuth, parseEventParams } from "@/lib/event-router";

/**
 * Jules API 呼び出しによるタスク自動化エンドポイント
 *
 * 共通の認証・パラメータ解析モジュールを利用してリクエストをパースし、
 * ビジネスロジックを実行するモジュール（executeJulesAutomation）に処理を委譲します。
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 認証チェック
    const auth = verifyEventAuth(request);
    if (!auth.authorized && auth.errorResponse) {
      return auth.errorResponse;
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

    // 3. リクエストパラメータの解析
    const { dryRun, task, limit } = await parseEventParams(request);

    // 4. ビジネスロジックを呼び出し
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
