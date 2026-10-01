import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface SidecarStatus {
  readonly running: boolean;
  readonly ready: boolean;
  readonly restarts: number;
}

export interface SidecarFatal {
  readonly message: string;
  readonly logDir: string;
}

export interface ISidecarTransport {
  send(line: string): Promise<void>;
  onMessage(cb: (line: string) => void): () => void;
  onStatus(cb: (status: SidecarStatus) => void): () => void;
  onFatal(cb: (fatal: SidecarFatal) => void): () => void;
  status(): Promise<SidecarStatus>;
}

type Listener<T> = (value: T) => void;

function subscribe<T>(eventName: string, callback: Listener<T>, select: (payload: unknown) => T): () => void {
  let active = true;
  let unlisten: (() => void) | undefined;
  void listen<unknown>(eventName, (event) => {
    if (active) callback(select(event.payload));
  }).then((stop) => {
    unlisten = stop;
    if (!active) stop();
  });
  return () => {
    active = false;
    unlisten?.();
  };
}

export class TauriTransport implements ISidecarTransport {
  public send(line: string): Promise<void> {
    return invoke<undefined>('sidecar_send', { line });
  }

  public onMessage(cb: (line: string) => void): () => void {
    return subscribe('sidecar://message', cb, (payload) => payload as string);
  }

  public onStatus(cb: (status: SidecarStatus) => void): () => void {
    return subscribe('sidecar://status', cb, (payload) => payload as SidecarStatus);
  }

  public onFatal(cb: (fatal: SidecarFatal) => void): () => void {
    return subscribe('sidecar://fatal', cb, (payload) => payload as SidecarFatal);
  }

  public status(): Promise<SidecarStatus> {
    return invoke<SidecarStatus>('sidecar_status');
  }
}

export class FakeTransport implements ISidecarTransport {
  public readonly sent: string[] = [];
  private readonly messageListeners = new Set<(line: string) => void>();
  private readonly statusListeners = new Set<(status: SidecarStatus) => void>();
  private readonly fatalListeners = new Set<(fatal: SidecarFatal) => void>();
  private currentStatus: SidecarStatus = { running: false, ready: false, restarts: 0 };

  public send(line: string): Promise<void> {
    this.sent.push(line);
    return Promise.resolve();
  }

  public onMessage(cb: (line: string) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  public onStatus(cb: (status: SidecarStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  public onFatal(cb: (fatal: SidecarFatal) => void): () => void {
    this.fatalListeners.add(cb);
    return () => this.fatalListeners.delete(cb);
  }

  public status(): Promise<SidecarStatus> {
    return Promise.resolve(this.currentStatus);
  }

  public receive(line: string): void {
    for (const listener of this.messageListeners) listener(line);
  }

  public setStatus(status: SidecarStatus): void {
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }

  public fail(fatal: SidecarFatal): void {
    for (const listener of this.fatalListeners) listener(fatal);
  }
}
