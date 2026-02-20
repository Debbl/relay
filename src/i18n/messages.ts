export const MESSAGES = {
  commandsHelpAvailable: 'Available commands:',
  commandsHelpLineHelp: '/help - Show help',
  commandsHelpLineNew: '/new [default|plan] - Create a new session',
  commandsHelpLineMode: '/mode <default|plan> - Switch current session mode',
  commandsHelpLineStatus: '/status - Show current session status',
  commandsHelpLineProjects: '/projects - Show current working directories',
  commandsHelpLineReset: '/reset - Clear current session',
  commandsErrorEmpty: 'Command cannot be empty.\n\n{helpText}',
  commandsErrorHelpNoArgs: '/help does not accept arguments.\n\n{helpText}',
  commandsErrorNewArgCount:
    '/new accepts at most one optional argument: default or plan.\n\n{helpText}',
  commandsErrorInvalidMode:
    'Invalid mode "{modeToken}", only default or plan are supported.\n\n{helpText}',
  commandsErrorModeNeedsArg:
    '/mode requires one argument: default or plan.\n\n{helpText}',
  commandsErrorStatusNoArgs: '/status does not accept arguments.\n\n{helpText}',
  commandsErrorProjectsNoArgs:
    '/projects does not accept arguments.\n\n{helpText}',
  commandsErrorResetNoArgs: '/reset does not accept arguments.\n\n{helpText}',
  commandsErrorUnknownCommand: 'Unknown command "{command}".\n\n{helpText}',

  handlerDefaultSessionTitle: 'New Session',
  handlerStatusNoSession:
    'No active session. Send a normal message or use /new to create one.',
  handlerStatusHeader: 'Current session status:',
  handlerStatusThread: 'thread: {threadId}',
  handlerStatusTitle: 'title: {title}',
  handlerStatusMode: 'mode: {mode}',
  handlerStatusModel: 'model: {model}',
  handlerProjectsNone: 'No working directories are currently open.',
  handlerProjectsHeader: 'Current working directories:',
  handlerProjectsItem: '{index}. {root}',
  handlerResetDone: 'Current session has been cleared.',
  handlerModeNoSession:
    'No active session. Send a normal message or use /new to create one first.',
  handlerModeSwitched: 'Switched to {mode} mode.',
  handlerNewCreated: 'Created a new session.',
  handlerNewThread: 'thread: {threadId}',
  handlerNewCwd: 'cwd: {cwd}',
  handlerNewMode: 'mode: {mode}',
  handlerNewModel: 'model: {model}',
  handlerErrorCodexDetailed: 'Codex execution failed: {message}',
  handlerErrorCodexGeneric: 'Codex execution failed. Please try again later.',
  handlerErrorProjectsDetailed: 'Failed to read open projects: {message}',
  handlerErrorProjectsGeneric:
    'Failed to read open projects. Please try again later.',
  handlerTitleSystemPromptZh:
    'You are a session title generator.\nGenerate a short Chinese title based on the user message.\nStrict requirements:\n1. Output title text only, with no explanation.\n2. Output a single line with no line breaks.\n3. Do not use quotes or title marks.\n4. Keep the title within 24 characters.',
  handlerTitleSystemPromptEn:
    'You are a session title generator.\nGenerate a short English title based on the user message.\nStrict requirements:\n1. Output title text only, with no explanation.\n2. Output a single line with no line breaks.\n3. Do not use quotes.\n4. Keep the title within 24 characters.',
  handlerTitleUserMessageZh: 'User message: {prompt}',
  handlerTitleUserMessageEn: 'User message: {prompt}',

  relayErrorParseMessage:
    'Failed to parse message. Please send a text message.',
  relayErrorSenderUnknown: 'Cannot identify sender. Please try again later.',
  relayErrorTextRequired: 'Please send a text message.',

  indexBusyMessage: 'Currently busy. Please try again later.',
  indexErrorProcessMessage:
    'Failed to process message. Please try again later.',

  startupErrorPrefix: 'Failed to start relay: {message}',

  configErrorMissing:
    'Relay config is missing. Template created at {configPath}. Please edit this file and restart.',
  configErrorReadFailed: 'Failed to read relay config at {configPath}: {error}',
  configErrorInvalidJson:
    'Invalid JSON in relay config at {configPath}: {error}',
  configErrorRootNotObject:
    'Invalid relay config at {configPath}: root must be a JSON object.',
  configErrorEnvNotObject:
    'Invalid relay config at {configPath}: env must be a JSON object.',
  configErrorRequiredString:
    'Invalid relay config: {field} is required and must be a non-empty string.',
  configErrorFieldMustString: 'Invalid relay config: {field} must be a string.',
  configErrorTimeoutPositiveInteger:
    'Invalid relay config: CODEX_TIMEOUT_MS must be a positive integer.',
  configWarnInvalidLocale:
    'Invalid relay config: LOCALE "{locale}" is not supported. Falling back to en.',
} as const

export type MessageKey = keyof typeof MESSAGES
export type MessageText = (typeof MESSAGES)[MessageKey]
