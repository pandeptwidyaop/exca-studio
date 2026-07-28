import pb from './pocketbase';

export type CollabRole = 'editor' | 'viewer';

export interface CollabUser {
  id: string;
  name: string;
  role: CollabRole;
}

export interface PointerPosition {
  x: number;
  y: number;
}

// Minimal structural view of an Excalidraw element — enough for delta
// tracking; the full element travels as an opaque payload.
export interface SceneElement {
  id: string;
  version: number;
  [key: string]: unknown;
}

export type SceneFiles = Record<string, unknown>;

interface ServerMessage {
  type: string;
  elements?: SceneElement[];
  files?: SceneFiles;
  pointer?: PointerPosition;
  user?: CollabUser;
  users?: CollabUser[];
  reason?: string;
}

export interface CollabCallbacks {
  onInit: (elements: SceneElement[], files: SceneFiles, users: CollabUser[]) => void;
  onSceneUpdate: (elements: SceneElement[]) => void;
  onFilesAdded: (files: SceneFiles) => void;
  onPointer: (user: CollabUser, pointer: PointerPosition) => void;
  onUsers: (users: CollabUser[]) => void;
  onSessionClosed: (reason: string) => void;
  onConnectionChange: (connected: boolean) => void;
}

const BROADCAST_THROTTLE_MS = 100;
const POINTER_THROTTLE_MS = 50;
const MAX_RECONNECT_DELAY_MS = 15000;
// After this many connection attempts that never reached "open" (likely
// 401/403 at upgrade), stop retrying; REST autosave keeps working.
const MAX_FAILED_ATTEMPTS = 5;

export default class CollabClient {
  private ws: WebSocket | null = null;
  private readonly projectId: string;
  private readonly callbacks: CollabCallbacks;
  private lastSent = new Map<string, number>();
  private sentFileIds = new Set<string>();
  private destroyed = false;
  private connected = false;
  private failedAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingElements: readonly SceneElement[] | null = null;
  private lastPointerAt = 0;

  constructor(projectId: string, callbacks: CollabCallbacks) {
    this.projectId = projectId;
    this.callbacks = callbacks;
    this.connect();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private connect() {
    if (this.destroyed) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws/collab/${this.projectId}?token=${encodeURIComponent(pb.authStore.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.failedAttempts = 0;
      this.connected = true;
      this.callbacks.onConnectionChange(true);
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) {
        this.callbacks.onConnectionChange(false);
      }
      if (this.destroyed) return;
      if (!wasConnected) {
        this.failedAttempts += 1;
        if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) return;
      }
      const delay = Math.min(1000 * 2 ** this.failedAttempts, MAX_RECONNECT_DELAY_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'init': {
        // Snapshot versions count as "already sent" so we don't echo them.
        this.lastSent = new Map();
        for (const el of msg.elements ?? []) {
          this.lastSent.set(el.id, el.version);
        }
        this.sentFileIds = new Set(Object.keys(msg.files ?? {}));
        this.callbacks.onUsers(msg.users ?? []);
        this.callbacks.onInit(msg.elements ?? [], msg.files ?? {}, msg.users ?? []);
        break;
      }
      case 'scene-update': {
        for (const el of msg.elements ?? []) {
          const prev = this.lastSent.get(el.id) ?? -1;
          if (el.version > prev) this.lastSent.set(el.id, el.version);
        }
        this.callbacks.onSceneUpdate(msg.elements ?? []);
        break;
      }
      case 'files-added': {
        for (const id of Object.keys(msg.files ?? {})) this.sentFileIds.add(id);
        this.callbacks.onFilesAdded(msg.files ?? {});
        break;
      }
      case 'pointer': {
        if (msg.user && msg.pointer) this.callbacks.onPointer(msg.user, msg.pointer);
        break;
      }
      case 'user-joined':
      case 'user-left': {
        this.callbacks.onUsers(msg.users ?? []);
        break;
      }
      case 'session-closed': {
        this.destroyed = true;
        this.callbacks.onSessionClosed(msg.reason ?? '');
        this.ws?.close();
        break;
      }
    }
  }

  // Queue the current element list; flushed at most every 100 ms
  // (trailing edge, so the final drag position always goes out).
  broadcastSceneElements(elements: readonly SceneElement[]) {
    this.pendingElements = elements;
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const els = this.pendingElements;
      this.pendingElements = null;
      if (els) this.flushElements(els);
    }, BROADCAST_THROTTLE_MS);
  }

  private flushElements(elements: readonly SceneElement[]) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const changed = elements.filter(
      (el) => el.version > (this.lastSent.get(el.id) ?? -1),
    );
    if (changed.length === 0) return;
    for (const el of changed) this.lastSent.set(el.id, el.version);
    this.ws.send(JSON.stringify({ type: 'scene-update', elements: changed }));
  }

  broadcastFiles(files: SceneFiles) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const added: SceneFiles = {};
    for (const [id, file] of Object.entries(files)) {
      if (!this.sentFileIds.has(id)) {
        this.sentFileIds.add(id);
        added[id] = file;
      }
    }
    if (Object.keys(added).length === 0) return;
    this.ws.send(JSON.stringify({ type: 'files-added', files: added }));
  }

  sendPointer(x: number, y: number) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - this.lastPointerAt < POINTER_THROTTLE_MS) return;
    this.lastPointerAt = now;
    this.ws.send(JSON.stringify({ type: 'pointer', pointer: { x, y } }));
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
      // Flush the pending batch so the final edit always goes out.
      const els = this.pendingElements;
      this.pendingElements = null;
      if (els) this.flushElements(els);
    }
    this.connected = false;
    this.ws?.close();
  }
}

// Deterministic per-user cursor/avatar color.
export function collabColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}
