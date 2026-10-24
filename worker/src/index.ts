import { PanelDurableObject } from './panel.js';
import type { WorkerEnv } from './runtime.js';

export { PanelDurableObject };

function panel(env: WorkerEnv): DurableObjectStub {
  return env.PANEL.get(env.PANEL.idFromName('global'));
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/') || pathname.startsWith('/health/')) {
      return panel(env).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
