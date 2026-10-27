export interface WorkspaceInfo {
  path: string;
  name: string;
}

export interface RecentWorkspace extends WorkspaceInfo {
  openedAt: number;
}

export interface WorkspaceState {
  workspace: WorkspaceInfo | null;
  recents: RecentWorkspace[];
}

export interface BrowseEntry {
  name: string;
  path: string;
  kind: 'drive' | 'directory';
}

export interface BrowseResult {
  path: string | null;
  parent: string | null;
  entries: BrowseEntry[];
  root: boolean;
}

export interface ModelChoice {
  id: string;
  name: string;
  providerID: string;
}

export interface ModelGroup {
  providerID: string;
  name: string;
  models: ModelChoice[];
}

export interface ModelKey {
  providerID: string;
  modelID: string;
}

export interface AgentChoice {
  name: string;
  description: string;
}

/** One agent declared by the workspace — the office floor staffs a person per entry. */
export interface AgentRosterEntry {
  name: string;
  mode: 'primary' | 'subagent';
  description: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  created: number;
  updated: number;
  agent: string | null;
  parentID: string | null;
}

/** What one busy session is doing right now, as reported by the bridge. */
export interface RunActivity {
  phase: 'prepare' | 'think' | 'tool' | 'write';
  tool: string | null;
  detail: string;
}

/** Result of writing the delegation-pacing rule into the workspace. */
export interface RuleState {
  tool: string;
  file: string | null;
  delayMs: number;
  ok: boolean;
  supported: boolean;
  changed: boolean;
}

export interface Bootstrap {
  workspace: WorkspaceInfo;
  models: ModelGroup[];
  defaultModel: ModelKey | null;
  agents: AgentChoice[];
  roster: AgentRosterEntry[];
  sessions: SessionSummary[];
  rules?: RuleState;
}

export interface ToolState {
  status: 'pending' | 'running' | 'completed' | 'error';
  title?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
  [key: string]: unknown;
}

export interface Part {
  id: string;
  type: string;
  messageID?: string;
  sessionID?: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: ToolState;
  time?: { start?: number; end?: number };
  [key: string]: unknown;
}

export interface MessageInfo {
  id: string;
  role: string;
  sessionID?: string;
  time?: { created?: number; completed?: number };
  error?: unknown;
  agent?: string;
  modelID?: string;
  providerID?: string;
  [key: string]: unknown;
}

export interface RawMessage {
  info: MessageInfo;
  parts?: Part[];
}

export interface LiveMessage {
  id: string;
  role: 'user' | 'assistant';
  created: number;
  completed?: number;
  error?: unknown;
  parts: Part[];
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission?: string;
  action?: string;
  patterns?: string[];
  resources?: string[];
  always?: string[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
  [key: string]: unknown;
}

export interface SessionStatus {
  type: 'idle' | 'busy' | 'retry' | string;
  message?: string;
  attempt?: number;
  [key: string]: unknown;
}

export interface SessionMessages {
  messages: RawMessage[];
  status: SessionStatus;
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
}

export interface ChatEvent {
  id?: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface PermissionReply {
  reply: 'once' | 'always' | 'reject';
}
