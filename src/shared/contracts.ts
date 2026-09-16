export type ModelKind = "llm" | "image" | "audio" | "video";

export type GatewayModel = {
  id: string;
  object?: string;
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
  status?: "complete" | "incomplete";
};

export type ThreadSummary = {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type ThreadSnapshot = ThreadSummary & { messages: PublicMessage[]; attachmentConsent: boolean };

export type PickedAttachment = {
  id: string;
  name: string;
  kind: "document" | "image" | "audio";
  size: number;
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
};

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done"; snapshot: ThreadSnapshot }
  | { type: "error"; message: string; snapshot?: ThreadSnapshot };

export type ImageRequest = {
  modelId: string;
  prompt: string;
  imageAttachmentIds: string[];
  aspectRatio?: string;
  deidentifiedConfirmed: boolean;
};

export type VideoRequest = {
  modelId: string;
  prompt: string;
  imageAttachmentIds: string[];
  aspectRatio?: string;
  deidentifiedConfirmed: boolean;
};

export type AudioRequest =
  | { lane: "tts"; modelId: string; input: string; voice?: string; deidentifiedConfirmed: boolean }
  | { lane: "stt"; modelId: string; attachmentId: string; deidentifiedConfirmed: boolean }
  | { lane: "music"; modelId: string; prompt: string; deidentifiedConfirmed: boolean };

export type MediaResult = {
  urls?: string[];
  text?: string;
  operationId?: string;
  status?: string;
  videoUrl?: string;
  audioUrl?: string;
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
  getCredits(): Promise<CreditBalance>;
  listThreads(): Promise<ThreadSummary[]>;
  createThread(modelId: string): Promise<ThreadSnapshot>;
  loadThread(id: string): Promise<ThreadSnapshot>;
  deleteThread(id: string): Promise<void>;
  pickAttachment(kinds: Array<"document" | "image" | "audio">): Promise<PickedAttachment | null>;
  addDroppedAttachments(
    files: DroppedAttachment[],
    kinds: Array<"document" | "image" | "audio">
  ): Promise<PickedAttachment[]>;
  acknowledgeAttachmentPrivacy(threadId: string): Promise<ThreadSnapshot>;
  streamChat(request: ChatRequest, onEvent: (event: ChatEvent) => void): () => void;
  generateImage(request: ImageRequest): Promise<MediaResult>;
  generateVideo(request: VideoRequest): Promise<MediaResult>;
  pollVideo(operationId: string, modelId: string): Promise<MediaResult>;
  runAudio(request: AudioRequest): Promise<MediaResult>;
  saveRemoteMedia(url: string, defaultName: string): Promise<boolean>;
  openKeyGuide(): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateChanged(onState: (state: UpdateState) => void): () => void;
};
