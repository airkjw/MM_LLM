export type ModelKind = "llm" | "image" | "audio" | "video";
export type WebSearchMode = "always" | "auto" | "deep" | "off";
export type ReasoningMode = "auto" | "fast" | "balanced" | "deep";
export type ThemeMode = "system" | "light" | "dark";
export type FontSizeMode = "small" | "medium" | "large";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export type JsonSchemaOutput = {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
};

export type ManualToolDefinition = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export type ManualToolCall = {
  id: string;
  name: string;
  arguments: string;
  status: "waiting" | "submitted" | "cancelled";
  result?: string;
};

export type ClaudeThinkingSettings = {
  mode: "off" | "adaptive" | "manual";
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  budgetTokens?: number;
};

export type ResponsesSettings = {
  background?: boolean;
  chain?: boolean;
  reasoningSummary?: "auto" | "none";
};

export type ChatAdvancedSettings = {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  stop?: string[];
  structuredOutput?: JsonSchemaOutput;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  thinkingBudget?: number;
  tools?: ManualToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responses?: ResponsesSettings;
  claudeThinking?: ClaudeThinkingSettings;
};

export type AppSettings = {
  defaultInstruction: string;
  theme: ThemeMode;
  fontSize: FontSizeMode;
};

export type GatewayModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  type: ModelKind;
  profile_image_url?: string | null;
  audio_client?: string;
};

export type CreditBalance = {
  total?: { quota?: number; used?: number; remaining?: number };
  monthly_allocated?: { quota?: number; used?: number; remaining?: number; renewal_date?: string };
  purchased?: { quota?: number; used?: number; remaining?: number };
};

export type PublicMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  attachments?: string[];
  status?: "complete" | "incomplete" | "resolved";
  usage?: TokenUsage;
  /** Provider-generated, user-visible reasoning summary. Raw hidden reasoning is never stored here. */
  reasoningSummary?: string;
  toolCalls?: ManualToolCall[];
  credits?: number;
  files?: Array<{ id: string; name: string; mediaUrl: string; expiresAt: string }>;
  backgroundResponseId?: string;
};

export type ThreadTarget =
  | { kind: "model"; modelId: string }
  | { kind: "chatbot"; chatbotId: string; alias: string };

export type ThreadSummary = {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  webSearchMode: WebSearchMode;
  pinned: boolean;
  purpose?: "meeting-summary";
  projectId?: string;
  target?: ThreadTarget;
};

export type ThreadSnapshot = ThreadSummary & {
  messages: PublicMessage[];
  attachmentConsent: boolean;
  instruction: string;
  reasoningMode: ReasoningMode;
  advanced: ChatAdvancedSettings;
};

export type CreateThreadRequest = {
  modelId: string;
  instruction?: string;
  purpose?: "meeting-summary";
  projectId?: string;
  target?: ThreadTarget;
};
export type ThreadSearchResult = ThreadSummary & { snippet: string };

export type PickedAttachment = {
  id: string;
  name: string;
  kind: "document" | "image" | "audio";
  size: number;
  /** Profile-scoped mmllm:// token for local preview; never an external URL. */
  mediaUrl?: string;
};

export type DroppedAttachment = {
  name: string;
  bytes: ArrayBuffer;
};

export type SessionState = {
  authenticated: boolean;
  models: GatewayModel[];
  credits?: CreditBalance;
};

export type ChatRequest = {
  threadId: string;
  modelId: string;
  text: string;
  attachmentIds: string[];
  regenerate?: boolean;
  regenerateAfterId?: string;
  continueIncompleteId?: string;
  toolResults?: { assistantMessageId: string; results: Array<{ toolCallId: string; result: string }> };
};

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning_summary"; text: string }
  | { type: "progress"; message: string }
  | { type: "tool_call"; call: ManualToolCall }
  | { type: "status"; status: string; responseId?: string }
  | { type: "credits"; credits: number }
  | { type: "files"; files: Array<{ id: string; name: string; mediaUrl: string; expiresAt: string }> }
  | { type: "done"; snapshot: ThreadSnapshot; usage?: TokenUsage }
  | { type: "error"; message: string; snapshot?: ThreadSnapshot };

export type BackgroundResponse = {
  id: string;
  threadId: string;
  modelId: string;
  status: "queued" | "in_progress" | "completed" | "incomplete" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  nextPollAt: string;
  pollCount: number;
  cancelRequested?: boolean;
  usage?: TokenUsage;
  outputText?: string;
  reasoningSummary?: string;
  error?: string;
  toolCalls?: ManualToolCall[];
};

export type ProjectDocument = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  instruction: string;
  documents: ProjectDocument[];
  threadCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ChatbotBookmark = {
  id: string;
  alias: string;
  chatbotId: string;
  createdAt: string;
};
export type ChatbotUsageReport = { retrievedAt: string; data: unknown; summary: string[] };

export type CompareRun = {
  id: string;
  prompt: string;
  modelIds: string[];
  webSearchMode: WebSearchMode;
  createdAt: string;
  attachmentNames: string[];
  results: Array<{ modelId: string; status: "running" | "completed" | "incomplete" | "failed" | "cancelled";
    text: string; usage?: TokenUsage; error?: string }>;
};

export type CompareRequest = {
  prompt: string;
  modelIds: string[];
  webSearchMode: WebSearchMode;
  attachmentIds: string[];
  deidentifiedConfirmed: boolean;
};

export type CompareEvent =
  | { type: "snapshot"; run: CompareRun }
  | { type: "delta"; runId: string; modelId: string; text: string }
  | { type: "status"; runId: string; modelId: string; status: CompareRun["results"][number]["status"] }
  | { type: "done"; run: CompareRun }
  | { type: "error"; message: string; run?: CompareRun };

export type ImageRequest = {
  modelId: string;
  prompt: string;
  imageAttachmentIds: string[];
  aspectRatio?: string;
  numberOfImages?: number;
  quality?: string;
  imageSize?: string;
  background?: string;
  deidentifiedConfirmed: boolean;
};

export type VideoRequest = {
  modelId: string;
  prompt: string;
  imageAttachmentIds: string[];
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  mode?: "standard" | "pro";
  loop?: boolean;
  audio?: boolean;
  deidentifiedConfirmed: boolean;
};

export type AudioRequest =
  | { lane: "tts"; modelId: string; input: string; voice?: string;
      speakers?: Record<string, string>; deidentifiedConfirmed: boolean }
  | { lane: "stt"; modelId: string; attachmentId: string; languageHints?: string[];
      enableSpeakerDiarization?: boolean; deidentifiedConfirmed: boolean }
  | { lane: "music"; modelId: string; prompt: string; lyrics?: string;
      durationSeconds?: number; instrumental?: boolean; deidentifiedConfirmed: boolean };

export type TranscriptSegment = {
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type MediaResult = {
  urls?: string[];
  text?: string;
  operationId?: string;
  status?: string;
  videoUrl?: string;
  audioUrl?: string;
  jobId?: string;
  kind?: "image" | "video" | "stt";
  createdAt?: string;
  elapsedMs?: number;
  error?: string;
  actualCredits?: number;
  creditDisplay?: string;
  durationSeconds?: number;
  billedDurationSeconds?: number;
  usage?: TokenUsage;
  musicStructure?: string;
  videoModelId?: string;
  segments?: TranscriptSegment[];
  sourceAudioUrl?: string;
};

export type PendingMediaJob = {
  id: string;
  kind: "image" | "video" | "stt";
  modelId: string;
  operationId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  attempts: number;
  nextPollAt: string;
  expiresAt: string;
  result?: MediaResult;
  sourceAudioUrl?: string;
  actualCredits?: number;
  durationSeconds?: number;
  billedDurationSeconds?: number;
  videoModelId?: string;
};

export type UpdateState = {
  status: "disabled" | "idle" | "checking" | "downloading" | "ready" | "latest" | "error";
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  message?: string;
};

export type DesktopApi = {
  getSession(): Promise<SessionState>;
  login(key: string): Promise<SessionState>;
  logout(): Promise<void>;
  refreshModels(): Promise<GatewayModel[]>;
  getCredits(force?: boolean): Promise<CreditBalance>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  setAppliedTheme(theme: "light" | "dark"): Promise<void>;
  listThreads(): Promise<ThreadSummary[]>;
  createThread(request: CreateThreadRequest): Promise<ThreadSnapshot>;
  loadThread(id: string): Promise<ThreadSnapshot>;
  deleteThread(id: string): Promise<void>;
  setWebSearchMode(id: string, mode: WebSearchMode): Promise<ThreadSnapshot>;
  updateThreadSettings(id: string, settings: {
    modelId: string;
    instruction: string;
    reasoningMode: ReasoningMode;
    advanced: ChatAdvancedSettings;
  }): Promise<ThreadSnapshot>;
  countClaudeInputTokens(id: string): Promise<{ inputTokens: number }>;
  setThreadProject(id: string, projectId?: string): Promise<ThreadSnapshot>;
  renameThread(id: string, title: string): Promise<ThreadSnapshot>;
  setThreadPinned(id: string, pinned: boolean): Promise<ThreadSnapshot>;
  searchThreads(query: string): Promise<ThreadSearchResult[]>;
  exportThread(id: string): Promise<boolean>;
  replaceApiKey(key: string): Promise<SessionState>;
  pickAttachment(kinds: Array<"document" | "image" | "audio">): Promise<PickedAttachment | null>;
  addDroppedAttachments(
    files: DroppedAttachment[],
    kinds: Array<"document" | "image" | "audio">
  ): Promise<PickedAttachment[]>;
  discardAttachments(ids: string[]): Promise<void>;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: { name: string; instruction: string }): Promise<ProjectSummary>;
  updateProject(id: string, input: { name: string; instruction: string }): Promise<ProjectSummary>;
  deleteProject(id: string): Promise<void>;
  addProjectDocument(projectId: string, attachmentId: string, deidentifiedConfirmed: boolean): Promise<ProjectSummary>;
  removeProjectDocument(projectId: string, documentId: string): Promise<void>;
  listCompareRuns(): Promise<CompareRun[]>;
  streamCompare(request: CompareRequest, onEvent: (event: CompareEvent) => void): () => void;
  continueCompare(runId: string, modelId: string): Promise<ThreadSnapshot>;
  listChatbotBookmarks(): Promise<ChatbotBookmark[]>;
  saveChatbotBookmark(input: { alias: string; chatbotId: string }): Promise<ChatbotBookmark>;
  deleteChatbotBookmark(id: string): Promise<void>;
  createChatbotThread(bookmarkId: string): Promise<ThreadSnapshot>;
  getChatbotUsage(bookmarkId: string): Promise<ChatbotUsageReport>;
  acknowledgeAttachmentPrivacy(threadId: string): Promise<ThreadSnapshot>;
  streamChat(request: ChatRequest, onEvent: (event: ChatEvent) => void): () => void;
  generateImage(request: ImageRequest): Promise<MediaResult>;
  generateVideo(request: VideoRequest): Promise<MediaResult>;
  runAudio(request: AudioRequest): Promise<MediaResult>;
  listMediaJobs(): Promise<PendingMediaJob[]>;
  pollMediaJob(id: string): Promise<MediaResult>;
  stopTrackingMediaJob(id: string): Promise<void>;
  releaseMediaJobSource(id: string): Promise<void>;
  acknowledgeMediaJob(id: string): Promise<void>;
  listBackgroundResponses(): Promise<BackgroundResponse[]>;
  pollBackgroundResponse(id: string): Promise<BackgroundResponse>;
  cancelBackgroundResponse(id: string): Promise<BackgroundResponse>;
  saveRemoteMedia(url: string, defaultName: string): Promise<boolean>;
  releaseMedia(url: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openKeyGuide(): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateChanged(onState: (state: UpdateState) => void): () => void;
};
