'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'initialized' | 'error';

export interface LogEntry {
  id: number;
  time: string;
  direction: 'in' | 'out' | 'system';
  content: string;
}

export interface Subscription {
  id: string;   // client-generated UUID
  topic: string;
}

let logId = 0;

function makeLog(direction: LogEntry['direction'], content: string): LogEntry {
  return {
    id: ++logId,
    time: new Date().toLocaleTimeString(),
    direction,
    content,
  };
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface ConnectOptions {
  wsUrl: string;
  accessToken: string;
  language?: string;
  lockdownToken?: string;
}

export function useWsDebug() {
  const [status, setStatus]               = useState<ConnectionStatus>('disconnected');
  const [logs, setLogs]                   = useState<LogEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const wsRef                             = useRef<WebSocket | null>(null);

  const addLog = useCallback((direction: LogEntry['direction'], content: string) => {
    setLogs((prev) => [...prev.slice(-199), makeLog(direction, content)]);
  }, []);

  /** 内部：直接发送原始字符串并记日志 */
  const sendRaw = useCallback((ws: WebSocket, payload: string) => {
    ws.send(payload);
    try {
      addLog('out', JSON.stringify(JSON.parse(payload), null, 2));
    } catch {
      addLog('out', payload);
    }
  }, [addLog]);

  const connect = useCallback((opts: ConnectOptions) => {
    if (wsRef.current) wsRef.current.close();

    setSubscriptions([]);
    setStatus('connecting');
    addLog('system', `Connecting to ${opts.wsUrl} ...`);

    const ws = new WebSocket(opts.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      addLog('system', 'WebSocket opened — sending connection_init ...');

      // 自动发送 connection_init
      const initMsg = JSON.stringify({
        type: 'connection_init',
        payload: {
          accessToken:   opts.accessToken,
          language:      opts.language || 'en',
          lockdownToken: opts.lockdownToken || '',
        },
      });
      sendRaw(ws, initMsg);
    };

    ws.onmessage = (e) => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(e.data);
        addLog('in', JSON.stringify(parsed, null, 2));
      } catch {
        addLog('in', e.data);
        return;
      }

      if (!parsed) return;

      // 收到 connection_ack → 状态变为 initialized
      if (parsed.type === 'connection_ack') {
        setStatus('initialized');
        addLog('system', 'Connection acknowledged — ready');
      }
    };

    ws.onerror = () => {
      setStatus('error');
      addLog('system', 'Connection error');
    };

    ws.onclose = (e) => {
      setStatus('disconnected');
      setSubscriptions([]);
      addLog('system', `Disconnected (code: ${e.code})`);
      wsRef.current = null;
    };
  }, [addLog, sendRaw]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
  }, []);

  /** 发送任意 JSON（手动输入框使用） */
  const sendMessage = useCallback((payload: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('system', 'Not connected');
      return;
    }
    sendRaw(wsRef.current, payload);
  }, [addLog, sendRaw]);

  /** 订阅指定 topic，返回订阅 id */
  const subscribe = useCallback((topic: string): string => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('system', 'Not connected');
      return '';
    }
    const id = generateId();
    const msg = JSON.stringify({ id, type: 'subscribe', payload: topic });
    sendRaw(wsRef.current, msg);
    setSubscriptions((prev) => [...prev, { id, topic }]);
    return id;
  }, [addLog, sendRaw]);

  /** 取消订阅（发送 complete） */
  const unsubscribe = useCallback((id: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('system', 'Not connected');
      return;
    }
    const msg = JSON.stringify({ id, type: 'complete' });
    sendRaw(wsRef.current, msg);
    setSubscriptions((prev) => prev.filter((s) => s.id !== id));
  }, [addLog, sendRaw]);

  /** 发送 ping */
  const ping = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('system', 'Not connected');
      return;
    }
    sendRaw(wsRef.current, JSON.stringify({ type: 'ping' }));
  }, [addLog, sendRaw]);

  const clearLogs = useCallback(() => setLogs([]), []);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  return {
    status,
    logs,
    subscriptions,
    connect,
    disconnect,
    sendMessage,
    subscribe,
    unsubscribe,
    ping,
    clearLogs,
  };
}
