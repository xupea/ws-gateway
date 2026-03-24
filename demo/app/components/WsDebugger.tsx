'use client';

import { useState, useRef, useEffect } from 'react';
import { useWsDebug, ConnectionStatus } from '../hooks/useWsDebug';

const STATUS_STYLE: Record<ConnectionStatus, string> = {
  disconnected: 'bg-gray-400',
  connecting:   'bg-yellow-400 animate-pulse',
  connected:    'bg-green-400',
  error:        'bg-red-500',
};

const LOG_STYLE = {
  in:     'text-green-400',
  out:    'text-blue-400',
  system: 'text-gray-400 italic',
};

const DEFAULT_PRESETS = [
  { label: 'Ping', value: JSON.stringify({ type: 'ping' }) },
  {
    label: 'Mock user msg',
    value: JSON.stringify({ type: 'user', userId: 'user-1', event: 'balance_update', data: { balance: 100 } }),
  },
  {
    label: 'Mock broadcast',
    value: JSON.stringify({ type: 'broadcast', event: 'announcement', data: { text: 'Hello everyone!' } }),
  },
];

export default function WsDebugger() {
  const { status, logs, connect, disconnect, sendMessage, clearLogs } = useWsDebug();

  const [wsUrl, setWsUrl]   = useState('ws://localhost:3001/ws');
  const [userId, setUserId] = useState('user-1');
  const [input, setInput]   = useState(DEFAULT_PRESETS[0].value);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleConnect = () => {
    if (status === 'connected') {
      disconnect();
    } else {
      connect(wsUrl, userId);
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input.trim());
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-mono text-sm">
      <h1 className="text-xl font-bold mb-6 text-white">WS Gateway Debugger</h1>

      {/* 连接配置 */}
      <div className="grid grid-cols-1 gap-3 mb-4 md:grid-cols-[1fr_200px_160px]">
        <input
          className="bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
          value={wsUrl}
          onChange={(e) => setWsUrl(e.target.value)}
          placeholder="ws://localhost:3001/ws"
        />
        <input
          className="bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="userId (作为 session)"
        />
        <button
          onClick={handleConnect}
          className={`rounded px-4 py-2 font-semibold transition-colors ${
            status === 'connected'
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {status === 'connected' ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {/* 状态栏 */}
      <div className="flex items-center gap-2 mb-4 text-xs">
        <span className={`inline-block w-2 h-2 rounded-full ${STATUS_STYLE[status]}`} />
        <span className="text-gray-400 capitalize">{status}</span>
      </div>

      {/* 消息日志 */}
      <div className="bg-gray-900 border border-gray-700 rounded h-96 overflow-y-auto p-4 mb-4">
        {logs.length === 0 && (
          <p className="text-gray-600">No messages yet...</p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="mb-1 leading-relaxed">
            <span className="text-gray-600 mr-2">{log.time}</span>
            <span className={`mr-2 ${LOG_STYLE[log.direction]}`}>
              {log.direction === 'in' ? '▼' : log.direction === 'out' ? '▲' : '·'}
            </span>
            <span className={LOG_STYLE[log.direction]}>
              <pre className="inline whitespace-pre-wrap break-all">{log.content}</pre>
            </span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* 发消息 */}
      <div className="flex gap-2 mb-3">
        <textarea
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400 resize-none h-20"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="JSON payload..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
          }}
        />
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSend}
            disabled={status !== 'connected'}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed rounded px-4 py-2 font-semibold"
          >
            Send
          </button>
          <button
            onClick={clearLogs}
            className="bg-gray-700 hover:bg-gray-600 rounded px-4 py-2"
          >
            Clear
          </button>
        </div>
      </div>

      {/* 预设快捷消息 */}
      <div className="flex gap-2 flex-wrap">
        {DEFAULT_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setInput(p.value)}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded px-3 py-1 text-xs"
          >
            {p.label}
          </button>
        ))}
      </div>

      <p className="mt-6 text-xs text-gray-600">
        Tip: userId 会作为 session cookie 的值。Gateway 开启 DEV_AUTH_BYPASS=true 时直接用该值作为 userId。
        发送快捷消息需要 Gateway 直接消费（通过 RabbitMQ），这里只测试 WebSocket 连接和收消息。
      </p>
    </div>
  );
}
