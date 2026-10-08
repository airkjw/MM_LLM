import type { GatewayModel } from './contracts';
export const VOICE_MODELS = ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'gemini-3.8-live', 'gemini-3.8-live-extended-thinking'] as const;
export type VoiceProvider = 'openai' | 'gemini' | 'soniox';
export type VoiceState = 'idle' | 'requesting_permission' | 'connecting' | 'active' | 'stopping' | 'closed' | 'error';
export type VoiceStart = { id: string; modelId: string; consent: true };
export type VoiceFrame = { id: string; sequence: number; format: 'pcm_s16le'; sampleRate: 16000 | 24000; channels: 1; bytes: Uint8Array };
export type VoiceControl = { id: string; type: 'received'; sequence: number } | { id: string; type: 'mute'; muted: boolean } |
  { id: string; type: 'played'; sequence: number; playedSamples: number } |
  { id: string; type: 'interrupted'; interruption: number; playedMs: number };
export type VoiceEvent = { id: string; delivery?: number } & (
  { type: 'state'; state: VoiceState; message?: string } |
  { type: 'audio'; sequence: number; bytes: Uint8Array; sampleRate: 24000; itemId?: string } |
  { type: 'interrupt'; interruption: number; itemId?: string } |
  { type: 'text'; final: string; provisional: string } |
  { type: 'activity'; activity: 'listening' | 'responding' | 'thinking' });
export const VOICE_TEXT_LIMIT = 12000;
export const VOICE_MESSAGE_LIMIT = 256 * 1024;
export const VOICE_QUEUE_SAMPLES = 24000 * 5;
export function voiceProvider(model: string): VoiceProvider {
  if (model === 'stt-rt-v5') return 'soniox';
  if (VOICE_MODELS.includes(model as typeof VOICE_MODELS[number])) return model.startsWith('gemini-') ? 'gemini' : 'openai';
  throw new Error('검토된 실시간 음성 모델을 선택해 주세요.');
}
export function voiceModels(models: GatewayModel[]): GatewayModel[] {
  return models.filter(m => m.type === 'realtime' && VOICE_MODELS.includes(m.id as typeof VOICE_MODELS[number]));
}
export function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function voiceId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error('음성 요청 ID가 올바르지 않습니다.');
}
export function keys(value: unknown, allowed: string[]): asserts value is Record<string, any> {
  if (!record(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('음성 요청 형식을 확인해 주세요.');
}
export function voiceCloseMessage(code: number): string {
  return ({1000:'음성 연결이 종료됐습니다. 세션 시간 상한 또는 제공사 종료일 수 있습니다.',1008:'인증·모델 권한·일회용 토큰 또는 초기 설정이 거절됐습니다.',1011:'Gateway 또는 음성 제공사 오류로 종료됐습니다.',1013:'동시 세션 또는 요청 제한으로 종료됐습니다. 자동 재연결하지 않습니다.',4402:'크레딧이 부족해 음성 연결이 종료됐습니다.'} as Record<number,string>)[code] ?? '음성 연결이 끊겼습니다. 다시 시작하려면 새로 시작해 주세요.';
}
