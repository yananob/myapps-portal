import { NextResponse } from "next/server";
import { getHiddenRepos, setRepoHidden } from "@/lib/firestore-client";

/**
 * 非表示設定されているリポジトリ一覧を取得します。
 */
export async function GET() {
  try {
    const hiddenRepos = await getHiddenRepos();
    return NextResponse.json({ hiddenRepos });
  } catch (error: any) {
    console.error("GET /api/hidden-repos エラー:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * リポジトリの非表示設定（表示/非表示）を保存・更新します。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repo, hidden } = body;

    if (!repo || typeof repo !== "string") {
      return NextResponse.json(
        { error: "無効なリポジトリ名が指定されました。" },
        { status: 400 }
      );
    }

    if (typeof hidden !== "boolean") {
      return NextResponse.json(
        { error: "無効な hidden フラグが指定されました。" },
        { status: 400 }
      );
    }

    await setRepoHidden(repo, hidden);

    return NextResponse.json({ success: true, repo, hidden });
  } catch (error: any) {
    console.error("POST /api/hidden-repos エラー:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
