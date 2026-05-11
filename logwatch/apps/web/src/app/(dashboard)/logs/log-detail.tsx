'use client';

import { useState } from 'react';

interface LogRecord {
  id: string;
  timestamp: string;
  severity_text: string;
  body: string;
  service_name: string;
  trace_id: string;
  span_id: string;
  resource_string: Record<string, string>;
  attributes_string: Record<string, string>;
}

export function LogDetail({ log, onClose }: { log: LogRecord; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'body' | 'attributes' | 'resource'>('body');

  const severityColor: Record<string, string> = {
    TRACE: 'text-gray-400',
    DEBUG: 'text-blue-400',
    INFO: 'text-green-400',
    WARN: 'text-yellow-400',
    ERROR: 'text-red-400',
    FATAL: 'text-red-600',
  };

  return (
    <div className="border-t border-gray-700 bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className={`font-mono text-sm font-bold ${severityColor[log.severity_text] ?? 'text-gray-400'}`}>
            {log.severity_text}
          </span>
          <span className="text-gray-400 text-xs font-mono">
            {new Date(log.timestamp).toISOString()}
          </span>
          <span className="text-gray-500 text-xs">{log.service_name}</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 text-sm"
          aria-label="Close detail panel"
        >
          Close
        </button>
      </div>

      {log.trace_id && (
        <div className="mb-3">
          <a
            href={`/traces/${log.trace_id}`}
            className="text-blue-400 hover:text-blue-300 text-sm font-mono"
          >
            Trace: {log.trace_id}
          </a>
          {log.span_id && (
            <span className="text-gray-500 text-sm font-mono ml-2">
              Span: {log.span_id}
            </span>
          )}
        </div>
      )}

      <div className="flex gap-2 mb-3">
        {(['body', 'attributes', 'resource'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 text-sm rounded ${
              activeTab === tab
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-gray-950 rounded p-3 font-mono text-sm overflow-auto max-h-64">
        {activeTab === 'body' && (
          <pre className="whitespace-pre-wrap text-gray-200">{log.body}</pre>
        )}
        {activeTab === 'attributes' && (
          <pre className="whitespace-pre-wrap text-gray-200">
            {JSON.stringify(log.attributes_string, null, 2)}
          </pre>
        )}
        {activeTab === 'resource' && (
          <pre className="whitespace-pre-wrap text-gray-200">
            {JSON.stringify(log.resource_string, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
