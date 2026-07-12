import { ServicesClient } from "@google-cloud/run";

let client: ServicesClient | null = null;

function getClient() {
  if (!client) {
    client = new ServicesClient();
  }
  return client;
}

export interface CloudRunService {
  name: string;
  url: string;
  logUrl: string;
  updatedAt: Date;
}

export async function getCloudRunServices(): Promise<CloudRunService[]> {
  const projectId = process.env.GCP_PROJECT_ID;
  const region = process.env.GCP_REGION || "asia-northeast1";

  if (!projectId) {
    throw new Error("GCP_PROJECT_ID is not set");
  }

  const client = getClient();
  const parent = `projects/${projectId}/locations/${region}`;

  try {
    const [services] = await client.listServices({ parent });

    return (services || []).map((service) => {
      const name = service.name?.split("/").pop() || "";
      const url = service.uri || "";
      const logUrl = `https://console.cloud.google.com/run/observability/${region}/${name}/logs?project=${projectId}&supportedpurview=project`;

      // Convert ITimestamp to Date
      const seconds = service.updateTime?.seconds;
      const updatedAt = seconds ? new Date(Number(seconds) * 1000) : new Date(0);

      return {
        name,
        url,
        logUrl,
        updatedAt,
      };
    });
  } catch (error) {
    console.error("Error fetching Cloud Run services:", error);
    throw error;
  }
}

export async function deleteCloudRunService(name: string): Promise<void> {
  const projectId = process.env.GCP_PROJECT_ID;
  const region = process.env.GCP_REGION || "asia-northeast1";

  if (!projectId) {
    throw new Error("GCP_PROJECT_ID is not set");
  }

  const client = getClient();
  const serviceName = `projects/${projectId}/locations/${region}/services/${name}`;

  try {
    const [operation] = await client.deleteService({ name: serviceName });
    // LRO (Long Running Operation) を待機
    await operation.promise();
  } catch (error) {
    console.error(`Error deleting Cloud Run service ${name}:`, error);
    throw error;
  }
}
