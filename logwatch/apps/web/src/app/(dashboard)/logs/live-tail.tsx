'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface LogRecord {
  id: string;
  timestamp: string;
  severity_text: string;
  body: string;
  service_name: string;
}

const MAX_RECORDS = 500;

export function LiveTail() {
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    const params = new URLSearchParams();
    if (filter) params.set('q', filter);

    const url = `/api/v1/logs/live?${params.toString()}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      if (paused) return;
      try {
        const record = JSON.parse(event.data) as LogRecord;
        setRecords((prev) => {
          const next = [...prev, record];
          return next.length > MAX_RECORDS ? next.slice(-MAX_RECORDS) : next;
        });
      } catch {
        // skip malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      setTimeout(connect, 3000);
    };
  }, [filter, paused]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    if (!paused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [records, paused]);

  const severityColor: Record<string, string> = {
    TRACE: 'text-gray-500',
    DEBUG: 'text-blue-400',
    INFO: 'text-green-400',
    WARN: 'text-yellow-400',
    ERROR: 'text-red-400',
    FATAL: 'text-red-600',
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-3 border-b border-gray-700">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-sm text-gray-400">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1 text-sm text-gray-200"
        />
        <button
          onClick={() => setPaused(!paused)}
          className={`px-3 py-1 text-sm rounded ${
            paused ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300'
          }`}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={() => setRecords([])}
          className="px-3 py-1 text-sm rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
        >
          Clear
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto font-mono text-xs p-2 bg-gray-950"
      >
        {records.map((record) => (
          <div key={record.id} className="flex gap-2 py-0.5 hover:bg-gray-900">
            <span className="text-gray-600 shrink-0">
              {new Date(record.timestamp).toISOString().slice(11, 23)}
            </span>
            <span className={`shrink-0 w-12 ${severityColor[record.severity_text] ?? 'text-gray-400'}`}>
              {record.severity_text.padEnd(5)}
            </span>
            <span className="text-cyan-400 shrink-0 w-32 truncate">
              {record.service_name}
            </span>
            <span className="text-gray-300 break-all">{record.body}</span>
          </div>
        ))}
        {records.length === 0 && (
          <div className="text-gray-600 text-center py-8">
            Waiting for logs...
          </div>
        )}
      </div>
    </div>
  );
}
