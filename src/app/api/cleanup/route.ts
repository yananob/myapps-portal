import { NextRequest, NextResponse } from "next/server";
import { getCloudRunServices, deleteCloudRunService } from "@/lib/gcp-client";

export async function POST(request: NextRequest) {
  try {
    // Basic authentication check using a shared secret
    const authHeader = request.headers.get("Authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Event/PubSubの検知
    let isEvent = false;
    let body: any = null;

    // CloudEventヘッダーの確認
    const ceType = request.headers.get("ce-type");
    const ceId = request.headers.get("ce-id");
    if (ceType || ceId) {
      isEvent = true;
    }

    // リクエストボディの読み込みとパース
    try {
      const text = await request.clone().text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // ボディパースエラーは無視
    }

    if (body && (body.message || body.subscription)) {
      isEvent = true;
    }

    // dry-runオプションの判定
    let bodyDryRun: boolean | null = null;
    if (body) {
      if (typeof body.dryRun !== "undefined") {
        bodyDryRun = body.dryRun === true || body.dryRun === "true";
      } else if (body.message?.data) {
        // Pub/Subメッセージのデータをデコードして確認
        try {
          const decodedData = Buffer.from(body.message.data, "base64").toString("utf-8");
          const parsedData = JSON.parse(decodedData);
          if (parsedData && typeof parsedData.dryRun !== "undefined") {
            bodyDryRun = parsedData.dryRun === true || parsedData.dryRun === "true";
          }
        } catch (e) {
          // デコード/パースエラーは無視
        }
      }
    }

    const urlString = request.url || "http://localhost/api/cleanup";
    const { searchParams } = new URL(urlString);
    const dryRunQuery = searchParams.get("dryRun");

    // デフォルトは安全のため dryRun = true（イベント起動・通常HTTP起動を問わず）
    let dryRun = true;
    if (dryRunQuery !== null) {
      dryRun = dryRunQuery !== "false";
    } else if (bodyDryRun !== null) {
      dryRun = bodyDryRun;
    }

    const services = await getCloudRunServices();
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const staleServices = services.filter((service) => {
      const isTestService =
        service.name.endsWith("-test") || service.name.endsWith("-test-event");
      const isStale = service.updatedAt < twentyFourHoursAgo;
      return isTestService && isStale;
    });

    if (dryRun) {
      console.log(`[Dry-run] 削除対象候補になったサービス (${staleServices.length}件):`);
      staleServices.forEach((service) => {
        console.log(`- ${service.name} (最終更新: ${service.updatedAt.toISOString()})`);
      });

      return NextResponse.json({
        message: `Dry-run completed. Found ${staleServices.length} candidates for deletion.`,
        deleted: [],
        failed: [],
        candidates: staleServices.map((s) => s.name),
        dryRun: true,
      });
    }

    console.log(`削除対象サービス (${staleServices.length}件) の削除を実行します。`);
    const results = await Promise.allSettled(
      staleServices.map(async (service) => {
        console.log(`サービスを削除しています: ${service.name}`);
        await deleteCloudRunService(service.name);
        return service.name;
      })
    );

    const deleted = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);

    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);

    console.log(`クリーンアップ処理完了。削除数: ${deleted.length}, 失敗数: ${failed.length}`);

    return NextResponse.json({
      message: `Cleanup completed. Deleted: ${deleted.length}, Failed: ${failed.length}`,
      deleted,
      failed,
      dryRun: false,
    });
  } catch (error: any) {
    console.error("Cleanup API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
