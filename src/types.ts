export interface CommandHistory {
  command: string;
  lastUsed: number;
  useCount: number;
  output?: string;
  error?: string;
  executionPath?: string;
}

export interface Preferences {
  maxHistorySize: number;
  defaultShell: string;
  shellProfile: string;
  debugMode: boolean;
}
