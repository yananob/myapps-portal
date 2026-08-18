import React from "react";
import { Github, MessageSquare, ListTodo, Globe, ExternalLink, Zap, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ServiceInstance } from "@/lib/types";

interface ServiceCardProps {
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
  isHidden?: boolean;
  onToggleHide?: (baseName: string) => void;
}

const InstanceButtons: React.FC<{
  instance?: ServiceInstance;
  colorClass: string;
}> = ({ instance, colorClass }) => {
  if (!instance) {
    return (
      <div className="flex gap-1 opacity-20 grayscale">
        <div className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-400 rounded border border-transparent whitespace-nowrap">
          <Globe className="w-3 h-3" /> <span className="hidden sm:inline">App</span>
        </div>
        <div className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-400 rounded border border-transparent whitespace-nowrap">
          <ListTodo className="w-3 h-3" /> <span className="hidden sm:inline">Log</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <a
        href={instance.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-medium text-white rounded transition-colors shadow-sm whitespace-nowrap",
          colorClass
        )}
        title="Open App"
      >
        <Globe className="w-3 h-3" />
        <span className="hidden sm:inline">App</span>
      </a>
      <a
        href={instance.logUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700 rounded transition-colors shadow-sm whitespace-nowrap"
        title="View Logs"
      >
        <ListTodo className="w-3 h-3 text-slate-500" />
        <span className="hidden sm:inline">Log</span>
      </a>
    </div>
  );
};

export const ServiceCard: React.FC<ServiceCardProps> = ({
  baseName,
  main,
  test,
  event,
  testEvent,
  repoUrl,
  issueUrl,
  julesUrl,
  hasDependabotAlerts,
  dependabotAlertsCount,
  dependabotUrl,
  isHidden = false,
  onToggleHide,
}) => {
  return (
    <div className={cn(
      "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm hover:shadow-md transition-all overflow-hidden",
      isHidden && "opacity-60 grayscale-[0.5]"
    )}>
      <div className="p-3 sm:p-4">
        {/* Name and Repo Links */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate" title={baseName}>
              {baseName}
            </h3>
            {onToggleHide && (
              <button
                onClick={() => onToggleHide(baseName)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0"
                title={isHidden ? "表示する" : "非表示にする"}
              >
                {isHidden ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            )}
            {hasDependabotAlerts && dependabotUrl && (
              <a
                href={dependabotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900/80 rounded-full transition-colors shrink-0"
                title={`Dependabot alert (${dependabotAlertsCount ?? 1})`}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Dependabot{dependabotAlertsCount !== undefined && dependabotAlertsCount > 0 ? ` (${dependabotAlertsCount})` : ""}</span>
              </a>
            )}
          </div>
          <div className="flex gap-4 shrink-0">
            {repoUrl ? (
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-blue-600 transition-colors p-1 -m-1"
                title="Repository"
              >
                <Github className="w-5 h-5 sm:w-6 h-6" />
              </a>
            ) : (
              <Github className="w-5 h-5 sm:w-6 h-6 text-slate-200 dark:text-slate-800 cursor-not-allowed" />
            )}
            {issueUrl ? (
              <a
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-blue-600 transition-colors p-1 -m-1"
                title="Issues"
              >
                <MessageSquare className="w-5 h-5 sm:w-6 h-6" />
              </a>
            ) : (
              <MessageSquare className="w-5 h-5 sm:w-6 h-6 text-slate-200 dark:text-slate-800 cursor-not-allowed" />
            )}
            {julesUrl ? (
              <a
                href={julesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-blue-600 transition-colors p-1 -m-1"
                title="Jules"
              >
                <Zap className="w-5 h-5 sm:w-6 h-6" />
              </a>
            ) : (
              <Zap className="w-5 h-5 sm:w-6 h-6 text-slate-200 dark:text-slate-800 cursor-not-allowed" />
            )}
          </div>
        </div>

        {/* Instances Table */}
        <div className="overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left pb-2 w-8">環境</th>
                <th className="text-[10px] font-bold uppercase tracking-wider text-blue-600 text-center pb-2 px-1">本番</th>
                <th className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 text-center pb-2 px-1">テスト</th>
              </tr>
            </thead>
            <tbody className="space-y-2">
              <tr>
                <td className="text-[10px] font-bold text-slate-400 uppercase pr-2 py-1">http</td>
                <td className="px-1 py-1">
                  <InstanceButtons
                    instance={main}
                    colorClass="bg-blue-600 hover:bg-blue-700"
                  />
                </td>
                <td className="px-1 py-1">
                  <InstanceButtons
                    instance={test}
                    colorClass="bg-emerald-600 hover:bg-emerald-700"
                  />
                </td>
              </tr>
              <tr>
                <td className="text-[10px] font-bold text-slate-400 uppercase pr-2 py-1">event</td>
                <td className="px-1 py-1">
                  <InstanceButtons
                    instance={event}
                    colorClass="bg-amber-600 hover:bg-amber-700"
                  />
                </td>
                <td className="px-1 py-1">
                  <InstanceButtons
                    instance={testEvent}
                    colorClass="bg-orange-600 hover:bg-orange-700"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
