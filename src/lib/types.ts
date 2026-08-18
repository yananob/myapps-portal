export interface ServiceInstance {
  url: string;
  logUrl: string;
}

export interface ServiceGroup {
  baseName: string;
  main?: ServiceInstance;
  test?: ServiceInstance;
  event?: ServiceInstance;
  testEvent?: ServiceInstance;
  repoUrl?: string;
  issueUrl?: string;
  julesUrl?: string;
  hasDependabotAlerts?: boolean;
  dependabotAlertsCount?: number;
  dependabotUrl?: string;
}

export interface GitHubRepoInfo {
  repoUrl: string;
  issueUrl: string;
  julesUrl: string;
  hasDependabotAlerts?: boolean;
  dependabotAlertsCount?: number;
  dependabotUrl?: string;
}
