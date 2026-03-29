// 认证成功后的用户信息（和 Java 接口返回结构对齐）
export interface AuthUser {
  userId: string;
  [key: string]: unknown;
}

// WebSocket 连接上挂载的用户数据
export interface WsUserData {
  userId: string;
  user: AuthUser | null;
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

// ---------- MQ 消息基础结构 ----------
export type MessageType = 'user' | 'broadcast' | 'topic';

export interface BaseMessage {
  type: MessageType;
  event: string;
  data: unknown;
}

// 推给指定用户
export interface UserMessage extends BaseMessage {
  type: 'user';
  userId: string;
}

// 广播给所有人
export interface BroadcastMessage extends BaseMessage {
  type: 'broadcast';
}

// 推送给订阅了某个 topic 的所有连接
export interface TopicPushMessage {
  type: 'topic';
  topic: string;  // 对应客户端 subscribe payload
  data: unknown;
}

export type PushMessage = UserMessage | BroadcastMessage | TopicPushMessage;

// WebSocket 连接上挂载的用户数据（需要 subscriptions 字段，在此导出便于复用）
export type SubscriptionMap = Map<string, string>; // subscriptionId → topic
