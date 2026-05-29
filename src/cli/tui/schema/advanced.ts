import type { CategoryDef } from './types.js';

export const advancedCategory: CategoryDef = {
  id: 'advanced',
  label: 'Advanced',
  description: 'Logging, proxy, daemon host/port',
  fields: [
    {
      key: 'WIGOLO_LOG_LEVEL',
      settingsPath: 'logLevel',
      label: 'Log level',
      kind: 'select',
      options: [
        { value: 'debug', label: 'debug' },
        { value: 'info', label: 'info' },
        { value: 'warn', label: 'warn' },
        { value: 'error', label: 'error' },
      ],
      default: 'info',
    },
    {
      key: 'PROXY_URL',
      settingsPath: 'proxyUrl',
      label: 'Proxy URL',
      kind: 'text',
      help: 'HTTP proxy URL',
    },
    {
      key: 'USE_PROXY',
      settingsPath: 'useProxy',
      label: 'Use proxy',
      kind: 'toggle',
      default: false,
    },
    {
      key: 'USER_AGENT',
      settingsPath: 'userAgent',
      label: 'User-Agent',
      kind: 'text',
      help: 'Custom User-Agent header',
    },
    {
      key: 'WIGOLO_DAEMON_PORT',
      settingsPath: 'daemonPort',
      label: 'Daemon port',
      kind: 'number',
      default: 7777,
      min: 1024,
      max: 65535,
    },
    {
      key: 'WIGOLO_DAEMON_HOST',
      settingsPath: 'daemonHost',
      label: 'Daemon host',
      kind: 'text',
      default: '127.0.0.1',
    },
  ],
};
