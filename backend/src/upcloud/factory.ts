import type { AppConfig } from '../config.js';
import { UpCloudClient } from './client.js';
import type { UpCloudGateway } from './types.js';

export type UpCloudGatewayFactory = (token: string) => UpCloudGateway;

export function createUpCloudFactory(config: AppConfig): UpCloudGatewayFactory {
  return (token) => new UpCloudClient(token, {
    timeoutMs: config.upcloudTimeoutMs,
    retryBaseMs: config.upcloudRetryBaseMs,
  });
}
