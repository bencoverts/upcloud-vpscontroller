export type PanelEvent = {
  type: 'ready' | 'job' | 'server' | 'token' | 'metric' | 'client' | 'access';
  payload: Record<string, unknown>;
};

export class PanelEvents {
  private readonly listeners = new Set<(event: PanelEvent) => void>();

  publish(event: PanelEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* One disconnected client must not interrupt other listeners. */ }
    }
  }

  subscribe(listener: (event: PanelEvent) => void): () => void {
    if (this.listeners.size >= 500) throw new Error('Too many realtime listeners.');
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
