'use client';

import { useState, useRef, useEffect } from 'react';
import { useWsDebug, ConnectionStatus } from '../hooks/useWsDebug';

const STATUS_STYLE: Record<ConnectionStatus, string> = {
  disconnected: 'bg-gray-400',
  connecting:   'bg-yellow-400 animate-pulse',
  connected:    'bg-yellow-400 animate-pulse',
  initialized:  'bg-green-400',
  error:        'bg-red-500',
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting:   'Connecting...',
  connected:    'Connected (waiting ack)',
  initialized:  'Initialized',
  error:        'Error',
};

const LOG_STYLE = {
  in:     'text-green-400',
  out:    'text-blue-400',
  system: 'text-gray-400 italic',
};

export default function WsDebugger() {
  const {
    status, logs, subscriptions,
    connect, disconnect,
    sendMessage, subscribe, unsubscribe, ping,
    clearLogs,
  } = useWsDebug();

  // 连接参数
  const [wsUrl, setWsUrl]             = useState('ws://localhost:3001/ws');
  const [accessToken, setAccessToken] = useState('b3f8cf666a18af715a6d2cc4e25a3220c5de420a761be2e23b2d3de0f071bbed1630c255b8bbabcfc4d8fdd396ce5ee5');
  const [language, setLanguage]       = useState('en');
  const [lockdownToken, setLockdown]  = useState('s5MNWtjTM5TvCMkAzxov');

  // 订阅
  const TOPICS = [
    'AvailableBalances',
    'VaultBalances',
    'HighrollerHouseBets',
    'Announcements',
    'RaceStatus',
    'FeatureFlag',
    'Notifications',
    'HouseBets',
    'depositBonusTransaction',
  ];
  const [topic, setTopic] = useState(TOPICS[0]);

  // 手动发消息
  const [input, setInput] = useState('');

  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const isConnected = status === 'connected' || status === 'initialized';

  const handleConnect = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect({ wsUrl, accessToken, language, lockdownToken });
    }
  };

  const handleSubscribe = () => {
    if (!topic.trim()) return;
    subscribe(topic.trim());
  };

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input.trim());
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-mono text-sm">
      <h1 className="text-xl font-bold mb-6 text-white">WS Gateway Debugger</h1>

      {/* ── 连接参数 ── */}
      <section className="mb-4 space-y-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_120px]">
          <input
            className="bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            placeholder="ws://localhost:3001/ws"
          />
          <button
            onClick={handleConnect}
            className={`rounded px-4 py-2 font-semibold transition-colors ${
              isConnected ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>

        <input
          className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="accessToken"
        />

        <div className="grid grid-cols-2 gap-2">
          <input
            className="bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="language (en)"
          />
          <input
            className="bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
            value={lockdownToken}
            onChange={(e) => setLockdown(e.target.value)}
            placeholder="lockdownToken"
          />
        </div>
      </section>

      {/* ── 状态栏 ── */}
      <div className="flex items-center gap-2 mb-4 text-xs">
        <span className={`inline-block w-2 h-2 rounded-full ${STATUS_STYLE[status]}`} />
        <span className="text-gray-400">{STATUS_LABEL[status]}</span>
      </div>

      {/* ── 日志 ── */}
      <div className="bg-gray-900 border border-gray-700 rounded h-80 overflow-y-auto p-4 mb-4">
        {logs.length === 0 && <p className="text-gray-600">No messages yet...</p>}
        {logs.map((log) => (
          <div key={log.id} className="mb-1 leading-relaxed">
            <span className="text-gray-600 mr-2">{log.time}</span>
            <span className={`mr-2 ${LOG_STYLE[log.direction]}`}>
              {log.direction === 'in' ? '▼' : log.direction === 'out' ? '▲' : '·'}
            </span>
            <pre className={`inline whitespace-pre-wrap break-all ${LOG_STYLE[log.direction]}`}>
              {log.content}
            </pre>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* ── 快捷操作 ── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={ping}
          disabled={!isConnected}
          className="bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed rounded px-4 py-2 font-semibold"
        >
          Ping
        </button>
        <button
          onClick={clearLogs}
          className="bg-gray-700 hover:bg-gray-600 rounded px-4 py-2"
        >
          Clear logs
        </button>
      </div>

      {/* ── 订阅 ── */}
      <section className="mb-4">
        <p className="text-gray-500 text-xs mb-2 uppercase tracking-wide">Subscribe</p>
        <div className="flex gap-2 mb-3">
          <select
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            {TOPICS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={handleSubscribe}
            disabled={status !== 'initialized'}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed rounded px-4 py-2 font-semibold"
          >
            Subscribe
          </button>
        </div>

        {/* 活跃订阅列表 */}
        {subscriptions.length > 0 && (
          <div className="space-y-1">
            {subscriptions.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs">
                <div>
                  <span className="text-green-400 font-semibold">{s.topic}</span>
                  <span className="text-gray-500 ml-3">{s.id}</span>
                </div>
                <button
                  onClick={() => unsubscribe(s.id)}
                  className="text-red-400 hover:text-red-300 ml-4"
                >
                  Unsubscribe
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 手动发消息 ── */}
      <section>
        <p className="text-gray-500 text-xs mb-2 uppercase tracking-wide">Manual message</p>
        <div className="flex gap-2">
          <textarea
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-400 resize-none h-20"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"type":"..."}  (Cmd/Ctrl+Enter to send)'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
            }}
          />
          <button
            onClick={handleSend}
            disabled={!isConnected}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded px-4 py-2 font-semibold"
          >
            Send
          </button>
        </div>
      </section>
    </div>
  );
}
