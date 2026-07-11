import { NextRequest, NextResponse } from "next/server";
import { getCloudRunServices, deleteCloudRunService } from "@/lib/gcp-client";

export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;

    // CRON_SECRET is required and must match the Authorization header
    if (!cronSecret) {
      console.error("CRON_SECRET environment variable is not set");
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }

    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") !== "false"; // Default to true

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
      console.log(`[Dry Run] Stale services identified for deletion: ${staleServices.map(s => s.name).join(", ")}`);
      return NextResponse.json({
        message: `Dry run completed. Identified ${staleServices.length} services for deletion.`,
        identified: staleServices.map(s => s.name),
        dryRun: true,
      });
    }

    const results = await Promise.allSettled(
      staleServices.map(async (service) => {
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
