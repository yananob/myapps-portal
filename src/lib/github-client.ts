import { Octokit } from "octokit";
import { GitHubRepoInfo } from "./types";

export type { GitHubRepoInfo };

/**
 * すべてのリポジトリ情報を取得し、リポジトリ名をキーにしたマップを返します。
 * N+1問題を避けるため、一括で取得します。
 */
export async function getAllReposInfo(options?: {
  includeDependabotAlerts?: boolean;
  includeOpenPullRequests?: boolean;
}): Promise<Map<string, GitHubRepoInfo>> {
  const includeDependabotAlerts = options?.includeDependabotAlerts ?? true;
  const includeOpenPullRequests = options?.includeOpenPullRequests ?? true;
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

    const alertsMap = new Map<string, { hasAlerts: boolean; count: number }>();
    const prsMap = new Map<string, number>();

    // 各リポジトリの Dependabot アラートおよび オープン PR 並行取得（オプションで有効な場合のみ）
    await Promise.all([
      includeDependabotAlerts
        ? Promise.allSettled(
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
          ).then((alertsResults) => {
            alertsResults.forEach((res) => {
              if (res.status === "fulfilled") {
                alertsMap.set(res.value.repoName, {
                  hasAlerts: res.value.hasAlerts,
                  count: res.value.count,
                });
              }
            });
          })
        : Promise.resolve(),

      includeOpenPullRequests
        ? Promise.allSettled(
            activeRepos.map(async (repo) => {
              try {
                const response = await octokit.rest.pulls.list({
                  owner: repo.owner.login,
                  repo: repo.name,
                  state: "open",
                  per_page: 100,
                });
                const count = response.data ? response.data.length : 0;
                return {
                  repoName: repo.name,
                  count,
                };
              } catch {
                return {
                  repoName: repo.name,
                  count: 0,
                };
              }
            })
          ).then((prsResults) => {
            prsResults.forEach((res) => {
              if (res.status === "fulfilled") {
                prsMap.set(res.value.repoName, res.value.count);
              }
            });
          })
        : Promise.resolve(),
    ]);

    const repoMap = new Map<string, GitHubRepoInfo>();
    for (const repo of activeRepos) {
      const alertInfo = alertsMap.get(repo.name) || { hasAlerts: false, count: 0 };
      const prCount = prsMap.get(repo.name) || 0;
      repoMap.set(repo.name, {
        repoUrl: repo.html_url,
        issueUrl: `${repo.html_url}/issues`,
        julesUrl: `https://jules.google.com/repo/github/${githubOwner}/${repo.name}/`,
        hasDependabotAlerts: alertInfo.hasAlerts,
        dependabotAlertsCount: alertInfo.count,
        dependabotUrl: `${repo.html_url}/security/dependabot`,
        openPullRequestsCount: prCount,
        pullRequestsUrl: `${repo.html_url}/pulls`,
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
 * 取得に失敗した場合や GITHUB_PAT が未設定の場合はデフォルトで "test" を返します。
 *
 * @param owner GitHub オーナー名（ユーザーまたは組織）
 * @param repo リポジトリ名
 * @returns デフォルトブランチ名（例: "test", "main"）
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
    return response.data.default_branch || "test";
  } catch (error) {
    console.warn(
      `[GitHubClient] リポジトリ (${owner}/${repo}) のデフォルトブランチ取得に失敗しました。フォールバックとして 'test' を使用します:`,
      error
    );
    return "test";
  }
}
