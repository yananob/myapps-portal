import { NextRequest } from "next/server";
import { handleEventRequest } from "@/lib/event-router";

/**
 * クリーンアップバッチエンドポイント（後方互換性の保持）
 *
 * handleEventRequest を使用して認証、パラメータ解析、およびタスクの実行（クリーンアップまたは各種イベント）を行います。
 */
export async function POST(request: NextRequest) {
  return handleEventRequest(request);
}
