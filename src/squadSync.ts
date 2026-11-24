// Dual-relay MQTT v3.1.1 over WSS client for zero-cost real-time Squad Sync.
// Connects concurrently to HiveMQ & EMQX public WSS brokers (plus Mosquitto fallback)
// and deduplicates incoming messages by msgId.

export type SyncWirePayload =
  | {
      v: 1;
      msgId: string;
      sender: string;
      ts: number;
      op: "hello";
    }
  | {
      v: 1;
      msgId: string;
      sender: string;
      ts: number;
      op: "ping";
    }
  | {
      v: 1;
      msgId: string;
      sender: string;
      ts: number;
      op: "set";
      target: string;
      remainingMs: number;
      totalSecs: number;
      isStart: boolean;
      isMinus5: boolean;
    }
  | {
      v: 1;
      msgId: string;
      sender: string;
      ts: number;
      op: "reset";
      target: string;
    }
  | {
      v: 1;
      msgId: string;
      sender: string;
      ts: number;
      op: "cosmic";
      enemyKey: string;
      enabled: boolean;
    }
  | {
      v: 1;
      msgId: string;
      sender: string;
      ts: number;
      op: "snapshot";
      timers: Array<{ target: string; remainingMs: number; totalSecs: number }>;
      cosmic: Record<string, boolean>;
    };

export type SyncWireBody =
  | { op: "hello" }
  | { op: "ping" }
  | {
      op: "set";
      target: string;
      remainingMs: number;
      totalSecs: number;
      isStart: boolean;
      isMinus5: boolean;
    }
  | { op: "reset"; target: string }
  | { op: "cosmic"; enemyKey: string; enabled: boolean }
  | {
      op: "snapshot";
      timers: Array<{ target: string; remainingMs: number; totalSecs: number }>;
      cosmic: Record<string, boolean>;
    };

export interface SyncStatus {
  connected: boolean;
  peerCount: number;
}

const PRIMARY_BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://test.mosquitto.org:8081/mqtt",
];
const FALLBACK_BROKER = "wss://broker.hivemq.com:8884/mqtt";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function randomId(len = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function encodeVarint(len: number): number[] {
  const out: number[] = [];
  let x = len;
  do {
    let encoded = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) encoded |= 0x80;
    out.push(encoded);
  } while (x > 0);
  return out;
}

function decodeVarint(
  buf: Uint8Array,
  offset: number
): { value: number; bytes: number } | null {
  let multiplier = 1;
  let value = 0;
  let bytes = 0;
  while (offset + bytes < buf.length) {
    const encoded = buf[offset + bytes];
    bytes += 1;
    value += (encoded & 127) * multiplier;
    if ((encoded & 128) === 0) {
      return { value, bytes };
    }
    multiplier *= 128;
    if (bytes >= 4) return null;
  }
  return null;
}

function encodeUtf8Field(str: string): Uint8Array {
  const bytes = textEncoder.encode(str);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function buildMqttConnectPacket(clientId: string, keepAliveSecs = 40): Uint8Array {
  const varHeader = new Uint8Array([
    0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, // "MQTT"
    0x04, // Level 4 (3.1.1)
    0x02, // CleanSession
    (keepAliveSecs >> 8) & 0xff,
    keepAliveSecs & 0xff,
  ]);
  const payload = encodeUtf8Field(clientId);
  const body = concatBytes(varHeader, payload);
  const rem = new Uint8Array(encodeVarint(body.length));
  return concatBytes(new Uint8Array([0x10]), rem, body);
}

function buildMqttSubscribePacket(packetId: number, topic: string): Uint8Array {
  const pid = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const topicField = encodeUtf8Field(topic);
  const qos = new Uint8Array([0x00]);
  const body = concatBytes(pid, topicField, qos);
  const rem = new Uint8Array(encodeVarint(body.length));
  return concatBytes(new Uint8Array([0x82]), rem, body);
}

function buildMqttPublishPacket(topic: string, payloadText: string): Uint8Array {
  const topicField = encodeUtf8Field(topic);
  const msgBytes = textEncoder.encode(payloadText);
  const body = concatBytes(topicField, msgBytes);
  const rem = new Uint8Array(encodeVarint(body.length));
  return concatBytes(new Uint8Array([0x30]), rem, body);
}

class MqttWsConnection {
  private ws: WebSocket | null = null;
  private rxBuf: Uint8Array = new Uint8Array(0);
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private backoffMs = 1500;
  private closed = false;
  private ready = false;
  private packetId = 1;
  private readonly mqttClientId: string;

  constructor(
    private readonly url: string,
    private readonly topic: string,
    private readonly onSubscribed: () => void,
    private readonly onMessageText: (text: string) => void,
    private readonly onStateChange: () => void
  ) {
    this.mqttClientId = `lst_${randomId(10)}`;
    this.connect();
  }

  public isReady(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  public publishText(payloadText: string): void {
    if (!this.isReady() || !this.ws) return;
    try {
      this.ws.send(buildMqttPublishPacket(this.topic, payloadText));
    } catch {
      // Ignore transient socket write error; close handler triggers reconnect.
    }
  }

  public close(): void {
    this.closed = true;
    this.ready = false;
    this.clearTimers();
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(new Uint8Array([0xe0, 0x00])); // DISCONNECT
        }
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.rxBuf = new Uint8Array(0);
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private connect(): void {
    if (this.closed) return;
    this.ready = false;
    this.rxBuf = new Uint8Array(0);

    try {
      const ws = new WebSocket(this.url, "mqtt");
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => {
        if (this.closed || this.ws !== ws) return;
        this.backoffMs = 1500;
        try {
          ws.send(buildMqttConnectPacket(this.mqttClientId, 40));
        } catch {
          this.scheduleReconnect();
        }
      };

      ws.onmessage = (ev) => {
        if (this.closed || this.ws !== ws) return;
        if (ev.data instanceof ArrayBuffer) {
          this.handleBinaryChunk(new Uint8Array(ev.data));
        }
      };

      ws.onerror = () => {
        if (this.closed || this.ws !== ws) return;
        this.ready = false;
        this.onStateChange();
      };

      ws.onclose = () => {
        if (this.closed || this.ws !== ws) return;
        this.ready = false;
        this.clearTimers();
        this.onStateChange();
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    const jitter = Math.floor(Math.random() * 600);
    const delay = this.backoffMs + jitter;
    this.backoffMs = Math.min(6000, this.backoffMs * 2);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleBinaryChunk(chunk: Uint8Array): void {
    this.rxBuf = concatBytes(this.rxBuf, chunk);

    while (this.rxBuf.length >= 2) {
      const headerByte = this.rxBuf[0];
      const rem = decodeVarint(this.rxBuf, 1);
      if (!rem) break;

      const totalPacketLen = 1 + rem.bytes + rem.value;
      if (this.rxBuf.length < totalPacketLen) break;

      const payloadStart = 1 + rem.bytes;
      const packetBody = this.rxBuf.slice(payloadStart, totalPacketLen);
      this.rxBuf = this.rxBuf.slice(totalPacketLen);

      const packetType = (headerByte >> 4) & 0x0f;
      if (packetType === 2) {
        // CONNACK
        if (packetBody.length >= 2 && packetBody[1] === 0) {
          const pid = this.packetId++;
          if (this.packetId > 65000) this.packetId = 1;
          try {
            this.ws?.send(buildMqttSubscribePacket(pid, this.topic));
          } catch {
            // ignore
          }
          if (this.pingTimer === null) {
            this.pingTimer = window.setInterval(() => {
              if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                  this.ws.send(new Uint8Array([0xc0, 0x00])); // PINGREQ
                } catch {
                  // ignore
                }
              }
            }, 20000);
          }
        }
      } else if (packetType === 9) {
        // SUBACK
        this.ready = true;
        this.onStateChange();
        this.onSubscribed();
      } else if (packetType === 3) {
        // PUBLISH
        if (packetBody.length < 2) continue;
        const topicLen = (packetBody[0] << 8) | packetBody[1];
        const qos = (headerByte >> 1) & 0x03;
        let offset = 2 + topicLen;
        if (qos > 0) offset += 2;
        if (offset <= packetBody.length) {
          const msgText = textDecoder.decode(packetBody.slice(offset));
          this.onMessageText(msgText);
        }
      }
    }
  }
}

export class SquadSyncClient {
  public readonly clientId: string;
  private readonly topic: string;
  private relays: MqttWsConnection[] = [];
  private fallbackActivated = false;
  private fallbackTimer: number | null = null;
  private housekeepTimer: number | null = null;
  private snapshotTimer: number | null = null;
  private lastPingSentAt = 0;
  private lastSnapshotSentAt = 0;
  private seenIds = new Set<string>();
  private seenQueue: string[] = [];
  private peers = new Map<string, number>();
  private destroyed = false;

  constructor(
    roomKey: string,
    private readonly onRemoteMessage: (msg: SyncWirePayload) => void,
    private readonly onStatusChange: (status: SyncStatus) => void,
    private readonly getSnapshot: () => {
      timers: Array<{ target: string; remainingMs: number; totalSecs: number }>;
      cosmic: Record<string, boolean>;
    }
  ) {
    this.clientId = `u_${randomId(10)}`;
    this.topic = `lolspelltimer/v1/room/${roomKey}`;

    for (const url of PRIMARY_BROKERS) {
      this.addRelay(url);
    }

    // Activate Mosquitto fallback only if neither primary relay is ready after 4s
    this.fallbackTimer = window.setTimeout(() => {
      if (this.destroyed || this.fallbackActivated) return;
      if (!this.relays.some((r) => r.isReady())) {
        this.fallbackActivated = true;
        this.addRelay(FALLBACK_BROKER);
      }
    }, 4000);

    this.housekeepTimer = window.setInterval(() => {
      if (this.destroyed) return;
      const now = Date.now();
      let pruned = false;
      for (const [peerId, lastSeen] of this.peers.entries()) {
        if (now - lastSeen > 32000) {
          this.peers.delete(peerId);
          pruned = true;
        }
      }
      if (pruned) {
        this.emitStatus();
      }
      if (now - this.lastPingSentAt >= 12000 && this.relays.some((r) => r.isReady())) {
        this.lastPingSentAt = now;
        this.send({ op: "ping" });
      }
    }, 5000);

    this.emitStatus();
  }

  public send(body: SyncWireBody): void {
    if (this.destroyed) return;
    const msg: SyncWirePayload = {
      ...body,
      v: 1,
      msgId: randomId(12),
      sender: this.clientId,
      ts: Date.now(),
    } as SyncWirePayload;

    this.recordSeen(msg.msgId);
    const json = JSON.stringify(msg);
    for (const r of this.relays) {
      r.publishText(json);
    }
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.housekeepTimer !== null) {
      window.clearInterval(this.housekeepTimer);
      this.housekeepTimer = null;
    }
    if (this.snapshotTimer !== null) {
      window.clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    for (const r of this.relays) {
      r.close();
    }
    this.relays = [];
    this.peers.clear();
  }

  private addRelay(url: string): void {
    const conn = new MqttWsConnection(
      url,
      this.topic,
      () => {
        this.send({ op: "hello" });
        this.lastPingSentAt = Date.now();
      },
      (text) => this.handleRawText(text),
      () => this.emitStatus()
    );
    this.relays.push(conn);
  }

  private recordSeen(id: string): boolean {
    if (this.seenIds.has(id)) return false;
    this.seenIds.add(id);
    this.seenQueue.push(id);
    if (this.seenQueue.length > 300) {
      const oldest = this.seenQueue.shift();
      if (oldest) this.seenIds.delete(oldest);
    }
    return true;
  }

  private emitStatus(): void {
    if (this.destroyed) return;
    this.onStatusChange({
      connected: this.relays.some((r) => r.isReady()),
      peerCount: this.peers.size,
    });
  }

  private handleRawText(text: string): void {
    if (this.destroyed) return;
    let parsed: SyncWirePayload | null = null;
    try {
      parsed = JSON.parse(text) as SyncWirePayload;
    } catch {
      return;
    }
    if (!parsed || parsed.v !== 1 || !parsed.msgId || !parsed.sender) return;
    if (parsed.sender === this.clientId) return;
    if (!this.recordSeen(parsed.msgId)) return;

    const prevCount = this.peers.size;
    this.peers.set(parsed.sender, Date.now());
    if (this.peers.size !== prevCount) {
      this.emitStatus();
    }

    if (parsed.op === "hello") {
      const now = Date.now();
      if (now - this.lastSnapshotSentAt >= 800 && this.snapshotTimer === null) {
        const delay = 100 + Math.floor(Math.random() * 180);
        this.snapshotTimer = window.setTimeout(() => {
          this.snapshotTimer = null;
          if (this.destroyed) return;
          const snap = this.getSnapshot();
          if (snap.timers.length > 0 || Object.keys(snap.cosmic).length > 0) {
            this.lastSnapshotSentAt = Date.now();
            this.send({
              op: "snapshot",
              timers: snap.timers,
              cosmic: snap.cosmic,
            });
          }
        }, delay);
      }
      return;
    }

    if (parsed.op === "ping") {
      return;
    }

    this.onRemoteMessage(parsed);
  }
}
