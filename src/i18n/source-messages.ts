import { msg } from '@lingui/core/macro'

export const SOURCE_MESSAGES = [
  msg({ message: 'Available commands:' }),
  msg({ message: '/help - Show help' }),
  msg({ message: '/new [default|plan] - Create a new session' }),
  msg({ message: '/mode <default|plan> - Switch current session mode' }),
  msg({ message: '/status - Show current session status' }),
  msg({ message: '/projects - Show current working directories' }),
  msg({ message: '/reset - Clear current session' }),
  msg({ message: 'Command cannot be empty.\n\n{helpText}' }),
  msg({ message: '/help does not accept arguments.\n\n{helpText}' }),
  msg({
    message:
      '/new accepts at most one optional argument: default or plan.\n\n{helpText}',
  }),
  msg({
    message:
      'Invalid mode "{modeToken}", only default or plan are supported.\n\n{helpText}',
  }),
  msg({
    message: '/mode requires one argument: default or plan.\n\n{helpText}',
  }),
  msg({ message: '/status does not accept arguments.\n\n{helpText}' }),
  msg({ message: '/projects does not accept arguments.\n\n{helpText}' }),
  msg({ message: '/reset does not accept arguments.\n\n{helpText}' }),
  msg({ message: 'Unknown command "{command}".\n\n{helpText}' }),

  msg({ message: 'New Session' }),
  msg({
    message:
      'No active session. Send a normal message or use /new to create one.',
  }),
  msg({ message: 'Current session status:' }),
  msg({ message: 'thread: {threadId}' }),
  msg({ message: 'title: {title}' }),
  msg({ message: 'mode: {mode}' }),
  msg({ message: 'model: {model}' }),
  msg({ message: 'No working directories are currently open.' }),
  msg({ message: 'Current working directories:' }),
  msg({ message: '{index}. {root}' }),
  msg({ message: 'Current session has been cleared.' }),
  msg({
    message:
      'No active session. Send a normal message or use /new to create one first.',
  }),
  msg({ message: 'Switched to {mode} mode.' }),
  msg({ message: 'Created a new session.' }),
  msg({ message: 'thread: {threadId}' }),
  msg({ message: 'cwd: {cwd}' }),
  msg({ message: 'mode: {mode}' }),
  msg({ message: 'model: {model}' }),
  msg({ message: 'Codex execution failed: {message}' }),
  msg({ message: 'Codex execution failed. Please try again later.' }),
  msg({ message: 'Failed to read open projects: {message}' }),
  msg({ message: 'Failed to read open projects. Please try again later.' }),
  msg({
    message:
      'You are a session title generator.\nGenerate a short Chinese title based on the user message.\nStrict requirements:\n1. Output title text only, with no explanation.\n2. Output a single line with no line breaks.\n3. Do not use quotes or title marks.\n4. Keep the title within 24 characters.',
  }),
  msg({
    message:
      'You are a session title generator.\nGenerate a short English title based on the user message.\nStrict requirements:\n1. Output title text only, with no explanation.\n2. Output a single line with no line breaks.\n3. Do not use quotes.\n4. Keep the title within 24 characters.',
  }),
  msg({ message: 'User message: {prompt}' }),

  msg({ message: 'Failed to parse message. Please send a text message.' }),
  msg({ message: 'Cannot identify sender. Please try again later.' }),
  msg({ message: 'Please send a text message.' }),

  msg({ message: 'Currently busy. Please try again later.' }),
  msg({ message: 'Failed to process message. Please try again later.' }),

  msg({ message: 'Failed to start relay: {message}' }),

  msg({
    message:
      'Relay config is missing. Template created at {configPath}. Please edit this file and restart.',
  }),
  msg({ message: 'Failed to read relay config at {configPath}: {error}' }),
  msg({ message: 'Invalid JSON in relay config at {configPath}: {error}' }),
  msg({
    message:
      'Invalid relay config at {configPath}: root must be a JSON object.',
  }),
  msg({
    message: 'Invalid relay config at {configPath}: env must be a JSON object.',
  }),
  msg({
    message:
      'Invalid relay config: {field} is required and must be a non-empty string.',
  }),
  msg({ message: 'Invalid relay config: {field} must be a string.' }),
  msg({
    message:
      'Invalid relay config: CODEX_TIMEOUT_MS must be a positive integer.',
  }),
  msg({
    message:
      'Invalid relay config: LOCALE "{locale}" is not supported. Falling back to en.',
  }),
]
