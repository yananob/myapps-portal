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

    const services = await getCloudRunServices();
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const staleServices = services.filter((service) => {
      const isTestService =
        service.name.endsWith("-test") || service.name.endsWith("-test-event");
      const isStale = service.updatedAt < twentyFourHoursAgo;
      return isTestService && isStale;
    });

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
    });
  } catch (error: any) {
    console.error("Cleanup API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
