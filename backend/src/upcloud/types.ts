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

export type UpCloudTemplate = {
  uuid: string; title: string; sizeGib: number; zone: string | null; access: string | null;
};
export type UpCloudPlan = {
  name: string; coreNumber: number; memoryMib: number; storageGib: number;
  storageTier: string | null; publicTrafficOutGib: number | null;
};
export type UpCloudZone = { id: string; description: string; public: boolean };
export type UpCloudDeploymentInput = {
  title: string; hostname: string; zone: string; plan: string; templateUuid: string;
  storageGib: number; storageTier: 'maxiops' | 'standard' | 'hdd';
  sshKeys: string[]; passwordDelivery: 'none' | 'email'; userData?: string;
};
export type UpCloudRebuildInput = {
  templateUuid: string; detachDisk: string; deleteDetachedDisk: boolean;
  storageTitle?: string; encrypted: boolean; sshKeys: string[]; passwordDelivery: 'none' | 'email';
};

export type UpCloudConfigurationUpdate = {
  title?: string; hostname?: string; plan?: string; timezone?: string;
  bootOrder?: string; nicModel?: string; metadata?: boolean;
};

export interface UpCloudGateway {
  getAccount(): Promise<{ username: string | null }>;
  listServers(): Promise<UpCloudServerSummary[]>;
  getServer(uuid: string): Promise<UpCloudServerDetails>;
  updateServer(uuid: string, identity: { title: string; hostname: string }): Promise<UpCloudServerDetails>;
  listTemplates(): Promise<UpCloudTemplate[]>;
  listPlans(): Promise<UpCloudPlan[]>;
  listZones(): Promise<UpCloudZone[]>;
  createServer(input: UpCloudDeploymentInput): Promise<UpCloudServerDetails>;
  rebuildServer(uuid: string, input: UpCloudRebuildInput): Promise<UpCloudServerDetails>;
  updateConfiguration(uuid: string, input: UpCloudConfigurationUpdate): Promise<UpCloudServerDetails>;
  deleteServer(uuid: string, deleteStorages: boolean): Promise<void>;
  getCpuStats(uuid: string, period?: UpCloudStatsSummary['period']): Promise<UpCloudStatsSummary>;
  getDiskStats(uuid: string, period?: UpCloudStatsSummary['period']): Promise<UpCloudStatsSummary>;
  getNetworkStats(uuid: string, period?: UpCloudStatsSummary['period']): Promise<UpCloudStatsSummary>;
  startServer(uuid: string): Promise<UpCloudServerDetails>;
  stopServer(uuid: string, stopType?: 'soft' | 'hard'): Promise<UpCloudServerDetails>;
  restartServer(uuid: string): Promise<UpCloudServerDetails>;
}
