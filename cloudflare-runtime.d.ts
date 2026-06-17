/** このWorkerで使用するCloudflare固有APIの最小型定義。 */
interface DurableObjectState {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
}

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

declare module "cloudflare:workers" {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
    fetch?(request: Request): Response | Promise<Response>;
    webSocketMessage?(
      socket: WebSocket,
      message: string | ArrayBuffer
    ): void | Promise<void>;
    webSocketClose?(
      socket: WebSocket,
      code: number,
      reason: string,
      wasClean: boolean
    ): void | Promise<void>;
  }
}
