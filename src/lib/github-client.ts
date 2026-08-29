import { Octokit } from "octokit";
import { GitHubRepoInfo } from "./types";

export type { GitHubRepoInfo };

/**
 * すべてのリポジトリ情報を取得し、リポジトリ名をキーにしたマップを返します。
 * N+1問題を避けるため、一括で取得します。
 */
export async function getAllReposInfo(): Promise<Map<string, GitHubRepoInfo>> {
  const githubPat = process.env.GITHUB_PAT;
  const githubOwner = process.env.GITHUB_OWNER;

  if (!githubOwner) {
    throw new Error("GITHUB_OWNER is not set");
  }

  const octokit = new Octokit({ auth: githubPat });

  try {
    // 認証ユーザーがアクセス可能なすべてのリポジトリを取得（パブリック・プライベート両方）
    const allRepos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      visibility: "all",
      per_page: 100,
    });

    // 指定されたオーナー（ユーザーまたは組織）のリポジトリのみにフィルタリングし、アーカイブされたリポジトリを除外
    const activeRepos = allRepos.filter(
      (repo) =>
        repo.owner.login.toLowerCase() === githubOwner.toLowerCase() &&
        !repo.archived
    );

    // 各リポジトリの Dependabot アラート並行取得
    const alertsResults = await Promise.allSettled(
      activeRepos.map(async (repo) => {
        try {
          const response = await octokit.rest.dependabot.listAlertsForRepo({
            owner: repo.owner.login,
            repo: repo.name,
            state: "open",
            per_page: 100,
          });
          const count = response.data ? response.data.length : 0;
          return {
            repoName: repo.name,
            hasAlerts: count > 0,
            count,
          };
        } catch {
          return {
            repoName: repo.name,
            hasAlerts: false,
            count: 0,
          };
        }
      })
    );

    const alertsMap = new Map<string, { hasAlerts: boolean; count: number }>();
    alertsResults.forEach((res) => {
      if (res.status === "fulfilled") {
        alertsMap.set(res.value.repoName, {
          hasAlerts: res.value.hasAlerts,
          count: res.value.count,
        });
      }
    });

    const repoMap = new Map<string, GitHubRepoInfo>();
    for (const repo of activeRepos) {
      const alertInfo = alertsMap.get(repo.name) || { hasAlerts: false, count: 0 };
      repoMap.set(repo.name, {
        repoUrl: repo.html_url,
        issueUrl: `${repo.html_url}/issues`,
        julesUrl: `https://jules.google.com/repo/github/${githubOwner}/${repo.name}/`,
        hasDependabotAlerts: alertInfo.hasAlerts,
        dependabotAlertsCount: alertInfo.count,
        dependabotUrl: `${repo.html_url}/security/dependabot`,
      });
    }
    return repoMap;
  } catch (error) {
    console.error("Error fetching GitHub repositories:", error);
    throw error;
  }
}

/**
 * 指定されたリポジトリのデフォルトブランチ（default_branch）を取得します。
 * 取得に失敗した場合や GITHUB_PAT が未設定の場合はデフォルトで "main" を返します。
 *
 * @param owner GitHub オーナー名（ユーザーまたは組織）
 * @param repo リポジトリ名
 * @returns デフォルトブランチ名（例: "main", "master"）
 */
export async function getRepoDefaultBranch(
  owner: string,
  repo: string
): Promise<string> {
  const githubPat = process.env.GITHUB_PAT;

  try {
    const octokit = new Octokit({ auth: githubPat });
    const response = await octokit.rest.repos.get({
      owner,
      repo,
    });
    return response.data.default_branch || "main";
  } catch (error) {
    console.warn(
      `[GitHubClient] リポジトリ (${owner}/${repo}) のデフォルトブランチ取得に失敗しました。フォールバックとして 'main' を使用します:`,
      error
    );
    return "main";
  }
}
