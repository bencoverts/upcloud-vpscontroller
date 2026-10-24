export type ServerState = 'started' | 'stopped' | 'maintenance' | 'error' | string;
export type TokenGroup = { id: string; name: string; enabled: boolean; selectedSlot: number | null; connectionStatus: string; validationStatus: string };
export type Server = {
  uuid: string; title: string; hostname: string | null; state: ServerState; zone: string | null;
  coreNumber: number; memoryMib: number; plan: string | null; osName: string | null; storageGib: number;
  upcloudCreatedAt: string | null; syncStatus: string; lastError: string | null;
  lastSyncedAt: string | null; detailsSyncedAt: string | null; lastSyncAttemptAt: string | null;
  publicIps: string[]; privateIps: string[]; networkConfigurationStatus: string;
  tokens: TokenGroup[]; groups: TokenGroup[];
  activeJob: { id: string; type: SyncJob['type']; status: string } | null;
};
export type Storage = {
  uuid: string; title: string | null; sizeGib: number; tier: string | null; deviceType: string | null;
  address: string | null; bootDisk: boolean | null; partOfPlan: boolean | null; zone: string | null;
  attached: boolean; labels: Array<{ key: string; value: string }>; syncedAt: string;
};
export type Network = {
  index: number; networkUuid: string | null; type: string | null; macAddress: string | null;
  bootable: boolean | null; sourceIpFiltering: boolean | null; syncedAt: string;
  ipAddresses: Array<{ address: string | null; family: string | null; access?: string | null; floating?: boolean | null; dhcpProvided?: boolean | null; releasePolicy?: string | null }>;
};
export type ServerDetail = Server & { config: Record<string, unknown>; storages: Storage[]; networks: Network[]; latestMetrics: MetricSample | null };
export type Token = {
  id: string; name: string; maskedToken: string; enabled: boolean; validationStatus: string; connectionStatus: string;
  expiresAt: string | null; expiryVerified: boolean; lastError: { code: string | null; message: string } | null;
  lastValidatedAt: string | null; lastUsedAt: string | null; lastSyncAt: string | null;
  createdAt: string; updatedAt: string; serverCount: number;
  selectedServers: Array<{ uuid: string; title: string; state: string; slot: number; active: boolean }>;
  activeJob: { id: string; type: SyncJob['type']; status: string } | null;
  syncJob?: SyncJob | null;
  syncNotice?: string;
};
export type SyncJob = {
  id: string; type: 'token_sync' | 'server_sync' | 'server_control'; status: string;
  tokenId: string | null; serverUuid: string | null; requestedBy: string | null; trigger: string; attempts: number;
  error: { code: string | null; message: string } | null; details: Record<string, any>;
  createdAt: string; startedAt: string | null; finishedAt: string | null; updatedAt: string;
};
export type MetricSample = {
  sampledAt: string; sourcePeriod: string; cpuPercent: number | null;
  diskReadBytesPerSecond: number | null; diskWriteBytesPerSecond: number | null;
  networkInBitsPerSecond: number | null; networkOutBitsPerSecond: number | null; rawSummary: any;
};
export type Availability = { available: boolean; source: string; reason: string | null };
export type MetricHistory = {
  range: string; points: MetricSample[]; latest: MetricSample | null;
  source: { type: string; upstreamPeriod: string; timestampMeaning: string; note: string };
  downsampled: boolean; downsamplingStrategy: string | null;
  availability: Record<'cpuUsage' | 'diskActivity' | 'networkTraffic' | 'memoryUsage' | 'swapUsage' | 'filesystemUsage' | 'osUptime', Availability>;
};
export type Dashboard = {
  totalServers: number; started: number; stopped: number; errorState: number; maintenance: number;
  connectionIssues: number; totalCores: number; totalMemoryMib: number; totalStorageGib: number;
  lastUpdatedAt: string | null; tokens: { total: number; enabled: number; degraded: number; invalid: number };
};
export type Pagination = { page: number; limit: number; total: number; pages: number };
export type Paged<T> = { items: T[]; pagination: Pagination };
export type ServerList = { items: Server[]; pagination: Pagination; filters: { zones: string[] } };
export type Settings = { syncIntervalSeconds: number; serverPollSeconds: number; metricsRefreshSeconds: number; metricsRetentionDays: number };
export type AuditLog = {
  id: string; userId: string | null; username: string | null; action: string; resourceType: string;
  resourceId: string | null; outcome: string; requestId: string | null; ipAddress: string | null;
  userAgent: string | null; details: Record<string, any>; createdAt: string;
};
export type PanelUser = { id: string; username: string; role: 'admin' | 'viewer' };
