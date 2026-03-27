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
}

// connection_init 消息的 payload
export interface ConnectionInitPayload {
  accessToken: string;
  language?: string;
  lockdownToken?: string;
  [key: string]: unknown;
}

// 客户端发送的 connection_init 消息
export interface ConnectionInitMessage {
  type: 'connection_init';
  payload: ConnectionInitPayload;
}

// MQ 消息基础结构
export type MessageType = 'user' | 'broadcast';

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

export type PushMessage = UserMessage | BroadcastMessage;
