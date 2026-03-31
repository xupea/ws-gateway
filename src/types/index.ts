// WebSocket 连接上挂载的数据，Gateway 不持有用户身份信息
export interface WsUserData {
  authToken: string;
  initialized: boolean;
  /** 当前连接的所有订阅：subscriptionId → topic */
  subscriptions: Map<string, string>;
}

// connection_init 消息的 payload
export interface ConnectionInitPayload {
  accessToken?: string;        // 已登录用户
  lockdownToken?: string;      // 未登录用户/游客
  language?: string;
  [key: string]: unknown;
}

// 客户端发送的 connection_init 消息
export interface ConnectionInitMessage {
  type: 'connection_init';
  payload: ConnectionInitPayload;
}

// ---------- 订阅协议消息 ----------

// 客户端发起订阅
export interface SubscribeMessage {
  id: string;       // 客户端生成的 UUID，贯穿整个订阅生命周期
  type: 'subscribe';
  payload: string;  // topic 名称，如 "AvailableBalances"
}

// 客户端取消订阅
export interface CompleteMessage {
  id: string;
  type: 'complete';
}

// 服务端推送订阅数据
export interface NextMessage {
  id: string;
  type: 'next';
  payload: { data: unknown };
}

// ---------- MQ 消息结构 ----------
export type MessageType = 'session' | 'broadcast' | 'topic';

// 推给指定 session（以 authToken 标识，Gateway 不持有 userId）
export interface SessionMessage {
  type: 'session';
  authToken: string;   // Java 侧用 userId 作 routing key，body 中放 authToken
  event: string;
  data: unknown;
}

// 广播给所有在线连接
export interface BroadcastMessage {
  type: 'broadcast';
  event: string;
  data: unknown;
}

// 推送给订阅了某个 topic 的所有连接
export interface TopicPushMessage {
  type: 'topic';
  topic: string;
  data: unknown;
}

export type PushMessage = SessionMessage | BroadcastMessage | TopicPushMessage;

export type SubscriptionMap = Map<string, string>; // subscriptionId → topic

// 支持的 WebSocket topics 列表（必须与 Java 端对齐）
export const SUPPORTED_TOPICS = [
  'ws.available-balances',
  'ws.vault-balances',
  'ws.highroller-house-bets',
  'ws.announcements',
  'ws.race-status',
  'ws.feature-flag',
  'ws.notifications',
  'ws.house-bets',
  'ws.deposit-bonus-transaction',
] as const;

export type SupportedTopic = typeof SUPPORTED_TOPICS[number];
