import { EventEmitter } from 'node:events';

export type PanelEvent = { type: 'job' | 'server' | 'token'; payload: Record<string, unknown> };

export class PanelEvents {
  private readonly emitter = new EventEmitter();
  constructor() { this.emitter.setMaxListeners(200); }
  publish(event: PanelEvent): void { this.emitter.emit('panel', event); }
  subscribe(listener: (event: PanelEvent) => void): () => void {
    this.emitter.on('panel', listener);
    return () => { this.emitter.off('panel', listener); };
  }
}
