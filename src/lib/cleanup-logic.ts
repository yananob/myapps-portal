import { getCloudRunServices, deleteCloudRunService } from "./gcp-client";

/**
 * クリーンアップ処理のオプション
 */
export interface CleanupOptions {
  dryRun?: boolean;
}

/**
 * クリーンアップ処理の結果
 */
export interface CleanupResult {
  message: string;
  deleted: string[];
  failed: string[];
  candidates?: string[];
  dryRun: boolean;
}

/**
 * テスト環境用サービスのクリーンアップ（削除から24時間経過したもの）を実行します。
 *
 * @param options クリーンアップオプション
 * @returns 処理結果
 */
export async function executeCleanup(options: CleanupOptions = {}): Promise<CleanupResult> {
  const dryRun = options.dryRun !== false; // デフォルトは安全のため true

  const services = await getCloudRunServices();
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 24時間以上更新されていないテスト用サービス（サフィックスが -test または -test-event）を抽出
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

    return {
      message: `Dry-run completed. Found ${staleServices.length} candidates for deletion.`,
      deleted: [],
      failed: [],
      candidates: staleServices.map((s) => s.name),
      dryRun: true,
    };
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

  return {
    message: `Cleanup completed. Deleted: ${deleted.length}, Failed: ${failed.length}`,
    deleted,
    failed,
    dryRun: false,
  };
}
