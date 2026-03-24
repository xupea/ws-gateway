'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LogEntry {
  id: number;
  time: string;
  direction: 'in' | 'out' | 'system';
  content: string;
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

export function useWsDebug() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const addLog = useCallback((direction: LogEntry['direction'], content: string) => {
    setLogs((prev) => [...prev.slice(-199), makeLog(direction, content)]);
  }, []);

  const connect = useCallback((wsUrl: string, userId: string) => {
    if (wsRef.current) wsRef.current.close();

    // 设置 session cookie，gateway 会用它做认证
    // DEV_AUTH_BYPASS=true 时，cookie 的值就是 userId
    document.cookie = `session=${encodeURIComponent(userId)}; path=/`;
    addLog('system', `Cookie set: session=${userId}`);

    setStatus('connecting');
    addLog('system', `Connecting to ${wsUrl} ...`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      addLog('system', 'Connected');
    };

    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        addLog('in', JSON.stringify(parsed, null, 2));
      } catch {
        addLog('in', e.data);
      }
    };

    ws.onerror = () => {
      setStatus('error');
      addLog('system', 'Connection error');
    };

    ws.onclose = (e) => {
      setStatus('disconnected');
      addLog('system', `Disconnected (code: ${e.code})`);
      wsRef.current = null;
    };
  }, [addLog]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
  }, []);

  const sendMessage = useCallback((payload: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('system', 'Not connected');
      return;
    }
    wsRef.current.send(payload);
    try {
      addLog('out', JSON.stringify(JSON.parse(payload), null, 2));
    } catch {
      addLog('out', payload);
    }
  }, [addLog]);

  const clearLogs = useCallback(() => setLogs([]), []);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  return { status, logs, connect, disconnect, sendMessage, clearLogs };
}
