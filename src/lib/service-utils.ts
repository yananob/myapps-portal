import { ServiceGroup, GitHubRepoInfo } from "@/lib/types";

export interface ServiceListItem {
  name: string;
  url: string;
  logUrl: string;
}

export function groupServices(services: ServiceListItem[], repoMap: Map<string, GitHubRepoInfo>): ServiceGroup[] {
  const groupsMap = new Map<string, ServiceGroup>();

  // 1. GitHubリポジトリをベースに初期グループを作成
  // マッチングを容易にするため、キーは小文字で保持する
  for (const [name, repoInfo] of repoMap.entries()) {
    groupsMap.set(name.toLowerCase(), {
      baseName: name,
      repoUrl: repoInfo.repoUrl,
      issueUrl: repoInfo.issueUrl,
      julesUrl: repoInfo.julesUrl,
      hasDependabotAlerts: repoInfo.hasDependabotAlerts,
      dependabotAlertsCount: repoInfo.dependabotAlertsCount,
      dependabotUrl: repoInfo.dependabotUrl,
    });
  }

  // 2. Cloud Runサービスを各グループに割り当て
  for (const service of services) {
    let baseName = service.name;
    let type: "main" | "test" | "event" | "testEvent" = "main";

    if (service.name.endsWith("-test-event")) {
      baseName = service.name.replace(/-test-event$/, "");
      type = "testEvent";
    } else if (service.name.endsWith("-test")) {
      baseName = service.name.replace(/-test$/, "");
      type = "test";
    } else if (service.name.endsWith("-event")) {
      baseName = service.name.replace(/-event$/, "");
      type = "event";
    }

    // Cloud Runサービス名は小文字なので、小文字でマッチングを行う
    const lookupKey = baseName.toLowerCase();
    let group = groupsMap.get(lookupKey);

    if (!group) {
      // リポジトリが見つからない場合でもグループを作成（Cloud Runのみ存在する場合）
      group = {
        baseName,
      };
      groupsMap.set(lookupKey, group);
    }

    group[type] = {
      url: service.url,
      logUrl: service.logUrl,
    };
  }

  return Array.from(groupsMap.values()).sort((a, b) =>
    a.baseName.localeCompare(b.baseName)
  );
}
