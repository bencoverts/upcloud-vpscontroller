export type UpCloudServerSummary = {
  uuid: string;
  title: string;
  hostname: string | null;
  state: string;
  zone: string | null;
  coreNumber: number;
  memoryMib: number;
  plan: string | null;
};

export type UpCloudStorage = {
  uuid: string;
  title: string | null;
  sizeGib: number;
  tier: string | null;
  deviceType: string | null;
  address: string | null;
  bootDisk: boolean | null;
  partOfPlan: boolean | null;
  labels: Array<{ key: string; value: string }>;
};

export type UpCloudIpAddress = {
  address: string | null;
  family: string | null;
  access?: string | null;
  dhcpProvided?: boolean | null;
  floating?: boolean | null;
  releasePolicy?: string | null;
  network?: string | null;
  gateway?: string | null;
  prefix?: string | null;
};

export type UpCloudNetwork = {
  index: number;
  networkUuid: string | null;
  type: string | null;
  macAddress: string | null;
  bootable: boolean | null;
  sourceIpFiltering: boolean | null;
  ipAddresses: UpCloudIpAddress[];
};

export type UpCloudServerDetails = UpCloudServerSummary & {
  osName: string | null;
  upcloudCreatedAt: Date | null;
  config: Record<string, unknown>;
  storages: UpCloudStorage[] | null;
  networks: UpCloudNetwork[] | null;
};

export type UpCloudStatsVariable = {
  title: string;
  current: string;
  average: string;
  maximum: string;
  total: string;
};

export type UpCloudStatsSummary = {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  variables: UpCloudStatsVariable[];
};

export interface UpCloudGateway {
  getAccount(): Promise<{ username: string | null }>;
  listServers(): Promise<UpCloudServerSummary[]>;
  getServer(uuid: string): Promise<UpCloudServerDetails>;
  updateServer(uuid: string, identity: { title: string; hostname: string }): Promise<UpCloudServerDetails>;
  getCpuStats(uuid: string, period?: UpCloudStatsSummary['period']): Promise<UpCloudStatsSummary>;
  getDiskStats(uuid: string, period?: UpCloudStatsSummary['period']): Promise<UpCloudStatsSummary>;
  getNetworkStats(uuid: string, period?: UpCloudStatsSummary['period']): Promise<UpCloudStatsSummary>;
  startServer(uuid: string): Promise<UpCloudServerDetails>;
  stopServer(uuid: string): Promise<UpCloudServerDetails>;
  restartServer(uuid: string): Promise<UpCloudServerDetails>;
}
