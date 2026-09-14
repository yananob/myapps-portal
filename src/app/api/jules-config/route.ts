import { NextResponse } from "next/server";
import { getJulesConfig, setJulesConfig, JulesConfig } from "@/lib/firestore-client";

/**
 * Jules 自動化設定（曜日別スケジュール・対象外リポジトリ）を取得します。
 */
export async function GET() {
  try {
    const config = await getJulesConfig();
    return NextResponse.json(config);
  } catch (error: any) {
    console.error("GET /api/jules-config エラー:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * Jules 自動化設定（曜日別スケジュール・対象外リポジトリ）を保存・更新します。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { schedule, excludedRepos } = body;

    if (!schedule || typeof schedule !== "object") {
      return NextResponse.json(
        { error: "無効な schedule 設定が指定されました。" },
        { status: 400 }
      );
    }

    if (!Array.isArray(excludedRepos)) {
      return NextResponse.json(
        { error: "無効な excludedRepos 設定が指定されました。" },
        { status: 400 }
      );
    }

    const newConfig: JulesConfig = {
      schedule: {
        sun: Boolean(schedule.sun),
        mon: Boolean(schedule.mon),
        tue: Boolean(schedule.tue),
        wed: Boolean(schedule.wed),
        thu: Boolean(schedule.thu),
        fri: Boolean(schedule.fri),
        sat: Boolean(schedule.sat),
      },
      excludedRepos: excludedRepos.map((r: any) => String(r)),
    };

    await setJulesConfig(newConfig);

    return NextResponse.json({ success: true, config: newConfig });
  } catch (error: any) {
    console.error("POST /api/jules-config エラー:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
