import { NextRequest } from "next/server";
import { handleEventRequest } from "@/lib/event-router";

/**
 * 汎用イベント処理ルーティングエンドポイント
 *
 * Pub/Sub や Eventarc、バッチスケジューラなどからのイベントリクエストを受信し、
 * イベント解析モジュール (handleEventRequest) を通して各処理タスクへと適切にルーティングします。
 */
export async function POST(request: NextRequest) {
  return handleEventRequest(request);
}
