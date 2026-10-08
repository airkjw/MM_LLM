import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { gatewayRequest, GatewayError } from './gateway-transport';
import { readJsonResponseWithLimit } from '../shared/bounded-json';
import { keys, record, voiceId, voiceProvider, voiceCloseMessage, voiceModels, VOICE_MESSAGE_LIMIT, VOICE_QUEUE_SAMPLES, VOICE_TEXT_LIMIT,
  type VoiceStart, type VoiceEvent, type VoiceProvider, type VoiceState } from '../shared/realtime';
import type { GatewayModel } from '../shared/contracts';
const ORIGIN = 'wss://factchat-cloud.mindlogic.ai';
export const VOICE_SESSION_URL = 'https://factchat-cloud.mindlogic.ai/v1/gateway/realtime/sessions/';
const GEMINI_PATH = '/v1/gateway/gemini/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const BOUNDED_WS_OPTIONS = Object.freeze({ maxPayload: VOICE_MESSAGE_LIMIT, handshakeTimeout: 10000, followRedirects: false, perMessageDeflate: false });
export function createVoiceSocket(url: string): WebSocket { return new WebSocket(url, { ...BOUNDED_WS_OPTIONS }); }
export function sessionSocketUrl(raw: unknown, model: string, now: number): { url: string; digest: string; expires: number } {
  if (!record(raw) || raw.object !== 'gateway.live_session' || raw.model !== model || typeof raw.token !== 'string' ||
      !/^[A-Za-z0-9_-]{16,512}$/.test(raw.token) || typeof raw.expires_at !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(raw.expires_at)) throw new Error('음성 세션 응답을 확인할 수 없습니다.');
  const expires = Date.parse(raw.expires_at);
  if (!Number.isFinite(expires) || expires <= now || expires > now + 61000) throw new Error('음성 세션 토큰이 만료됐거나 유효 시간을 확인할 수 없습니다. 새로 시작해 주세요.');
  const provider = voiceProvider(model);
  const path = provider === 'openai' ? `/v1/gateway/realtime?model=${model}` : provider === 'gemini' ? GEMINI_PATH : '/v1/gateway/soniox/transcribe-websocket';
  // Byte-exact relative route; rejects credentials, host, fragments, duplicate/secret query and alternate versions.
  if (raw.url !== path) throw new Error('허용되지 않은 음성 연결 경로입니다.');
  return { url: ORIGIN + path + (provider === 'openai' ? '&' : '?') + 'token=' + encodeURIComponent(raw.token),
    digest: createHash('sha256').update(raw.token).digest('hex'), expires };
}
export type VoiceIdentity = { epoch: number; profileId: string; owner: number };
export type VoiceTextClaim = { modelId: string; text: string; identity: VoiceIdentity;
  assertCurrent: () => void; commit: () => void; rollback: () => void };
export type VoiceSocket = Pick<WebSocket, 'on' | 'removeAllListeners' | 'send' | 'close' | 'terminate' | 'readyState' | 'bufferedAmount'>;
type Session = VoiceIdentity & { id: string; modelId: string; provider: VoiceProvider; state: VoiceState; controller: AbortController;
  socket?: VoiceSocket; keepalive?: ReturnType<typeof setInterval>; sonioxFinals: Set<string>; sonioxFinished: boolean; timer?: ReturnType<typeof setTimeout>; deliveries: Set<number>; delivery: number; inputSequence: number; muted: boolean; windowAt: number; windowBytes: number;
  receiveAt: number; receiveBytes: number; receiveCount: number; outputSequence: number; outputs: Map<number,{samples:number;itemId?:string}>;
  final: string; provisional: string; itemId?: string; itemSamples: number; playedSamples: number; interruption: number; awaitingInterrupt: boolean;
  discardedThrough: number; geminiInput: string; geminiOutput: string; interaction: 'IN_PROGRESS' | 'IDLE'; blockedItems: Set<string>; connectStarted: boolean };
type EventBody = VoiceEvent extends infer E ? E extends VoiceEvent ? Omit<E, 'id'> : never : never;
type Dependencies = { identity: () => VoiceIdentity; emit: (event: VoiceEvent) => void; models: () => GatewayModel[];
  socket?: (url: string) => VoiceSocket; fetch?: typeof fetch; now?: () => number };
export class RealtimeSessionManager {
  private current?: Session;
  private usedTokens = new Map<string,number>();
  private completed?: { identity: VoiceIdentity; id: string; modelId: string; text: string;
    claimed: boolean; reservation?: object };
  private deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; }
  get size(): number { return this.current ? 1 : 0; }
  get permissionPending(): boolean { return !!this.current && this.current.state === 'requesting_permission' && this.owned(this.current); }
  private now() { return (this.deps.now ?? Date.now)(); }
  private owned(s: Session): boolean {
    const i = this.deps.identity(); return this.current === s && s.epoch === i.epoch && s.profileId === i.profileId && s.owner === i.owner && !s.controller.signal.aborted;
  }
  private event(s: Session, e: EventBody): void {
    if(!this.owned(s))return;
    if(s.deliveries.size>=32 && e.type!=='state'){this.finish(s,'error','음성 화면 수신이 지연돼 세션을 종료했습니다.');return;}
    const delivery=++s.delivery;s.deliveries.add(delivery);this.deps.emit({id:s.id,delivery,...e} as VoiceEvent);
  }
  private state(s: Session, state: VoiceState, message?: string) { s.state = state; this.event(s,{type:'state',state,...(message ? {message} : {})}); }
  begin(raw: unknown): void {
    keys(raw,['id','modelId','consent']); voiceId(raw.id);
    if (this.current) throw new Error('이미 준비 중이거나 실행 중인 음성 세션이 있습니다.');
    if (raw.consent !== true || typeof raw.modelId !== 'string') throw new Error('마이크 외부 전송과 과금 안내에 동의해 주세요.');
    const request = raw as VoiceStart; const provider = voiceProvider(request.modelId);
    if (provider !== 'soniox' && !voiceModels(this.deps.models()).some(m=>m.id===request.modelId)) throw new Error('현재 계정 목록에서 사용할 수 있는 실시간 모델을 선택해 주세요.');
    this.completed = undefined;
    const s: Session = { ...this.deps.identity(), id:request.id, modelId:request.modelId, provider, state:'requesting_permission', controller:new AbortController(),
      sonioxFinals:new Set(),sonioxFinished:false,deliveries:new Set(),delivery:0,inputSequence:0, muted:false, windowAt:this.now(),windowBytes:0,receiveAt:this.now(),receiveBytes:0,receiveCount:0,
      outputSequence:0, outputs:new Map(),final:'',provisional:'',itemSamples:0,playedSamples:0,interruption:0,awaitingInterrupt:false,
      discardedThrough:0,geminiInput:'',geminiOutput:'',interaction:'IDLE',blockedItems:new Set(),connectStarted:false };
    this.current = s; this.state(s,'requesting_permission');
    s.timer = setTimeout(()=>this.finish(s,'error','마이크 준비 시간이 초과됐습니다. 새로 시작해 주세요.'),60000);
  }
  private require(id: unknown): Session {
    voiceId(id); const s = this.current;
    if (!s || s.id !== id || !this.owned(s)) { if(s && !this.owned(s)) this.abort(); throw new Error('종료됐거나 다른 계정의 음성 세션입니다.'); }
    return s;
  }
  async connect(id: unknown, key: string): Promise<void> {
    const s = this.require(id);
    if (s.state !== 'requesting_permission' || s.connectStarted) throw new Error('음성 연결을 이미 시작했습니다.');
    s.connectStarted = true; clearTimeout(s.timer); this.state(s,'connecting');
    try {
      const response = await gatewayRequest(VOICE_SESSION_URL,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
        body:JSON.stringify({model:s.modelId}),signal:s.controller.signal},{fetch:this.deps.fetch,timeoutMs:15000});
      const raw = await readJsonResponseWithLimit(response,8192);
      if (!this.owned(s)) return;
      const issued = sessionSocketUrl(raw,s.modelId,this.now());
      for (const [hash,expiry] of this.usedTokens) if (expiry <= this.now()) this.usedTokens.delete(hash);
      if (this.usedTokens.has(issued.digest)) throw new Error('이미 사용한 음성 세션 토큰입니다. 새로 시작해 주세요.');
      this.usedTokens.set(issued.digest,issued.expires);
      // No retry, refresh, alternate route, key in WS headers or token exposure to IPC.
      const socket = (this.deps.socket ?? createVoiceSocket)(issued.url); s.socket = socket;
      s.timer = setTimeout(()=>this.finish(s,'error','음성 초기 설정 응답 시간이 초과됐습니다. 새로 시작해 주세요.'),Math.min(10000,issued.expires-this.now()));
      socket.on('error',()=>this.finish(s,'error','음성 연결에 실패했습니다. 자동 재연결하지 않습니다.'));
      socket.on('close',(code:number)=>this.finish(s,code===1000?'closed':'error',s.provider==='soniox' && !s.sonioxFinished && code===1000 ? '연결이 종료됐으며 마지막 확정 응답은 확인하지 못했습니다. 수신된 확정문만 남깁니다.' : voiceCloseMessage(code)));
      socket.on('open',()=>{ if (!this.owned(s)) return this.abort(); try { this.initialize(s); } catch { this.finish(s,'error','음성 초기 설정을 전송하지 못했습니다.'); } });
      socket.on('message',(data: WebSocket.RawData,isBinary:boolean)=>{ if (!this.owned(s)) return; try { this.receive(s,data,isBinary); } catch { this.finish(s,'error','음성 응답 형식 또는 처리 한도를 확인해 주세요.'); } });
    } catch (e) {
      if (!this.owned(s)) return;
      const message = e instanceof GatewayError ? ({400:'음성 모델 또는 입력 설정이 거절됐습니다.',401:'API 키가 유효하지 않습니다.',402:'크레딧이 부족합니다.',403:'이 계정의 음성 권한이 거절됐습니다.',429:'요청 제한으로 음성 시작이 거절됐습니다.'} as Record<number,string>)[e.status] ?? 'Gateway 음성 시작이 거절됐습니다.' : '음성 세션 발급·검증 또는 연결에 실패했습니다. 새로 시작해 주세요.';
      this.finish(s,'error',message);
    }
  }
  private send(s: Session, data: string | Uint8Array) {
    if (!this.owned(s) || !s.socket || s.socket.readyState !== WebSocket.OPEN) throw new Error('음성 연결이 없습니다.');
    if (s.socket.bufferedAmount + Buffer.byteLength(data) > 128*1024) throw new Error('음성 전송이 지연됐습니다.');
    s.socket.send(data,{binary:typeof data!=='string'},e=>{if(e)this.finish(s,'error','음성 전송이 지연돼 종료했습니다.');});
  }
  private json(s:Session,value:unknown) { this.send(s,JSON.stringify(value)); }
  private initialize(s:Session) {
    if(s.provider==='openai') this.json(s,{type:'session.update',session:{type:'realtime',output_modalities:['audio'],tools:[],
      audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:'gpt-4o-mini-transcribe'},turn_detection:{type:'server_vad',create_response:true,interrupt_response:true}},
      output:{format:{type:'audio/pcm',rate:24000}}}}});
    else if(s.provider==='gemini') this.json(s,{setup:{model:`models/${s.modelId}`,generationConfig:{responseModalities:['AUDIO']},
      inputAudioTranscription:{},outputAudioTranscription:{}}});
    else {
      this.json(s,{model:'stt-rt-v5',audio_format:'pcm_s16le',sample_rate:24000,num_channels:1,language_hints:['ko']});
      clearTimeout(s.timer);this.state(s,'active');
      s.keepalive=setInterval(()=>{if(this.owned(s)&&s.state==='active'&&s.muted){try{this.json(s,{type:'keepalive'});}catch{this.finish(s,'error','음소거 중 연결을 유지하지 못했습니다.');}}},10000);
    }
  }
  frame(raw:unknown):void {
    keys(raw,['id','sequence','format','sampleRate','channels','bytes']); const s=this.require(raw.id);
    try {
      const rate=s.provider==='gemini'?16000:24000;
      if(s.state!=='active' || s.muted) return;
      if(raw.format!=='pcm_s16le'||raw.sampleRate!==rate||raw.channels!==1||!Number.isSafeInteger(raw.sequence)||raw.sequence!==s.inputSequence+1||
        !(raw.bytes instanceof Uint8Array)||raw.bytes.byteLength!==rate/10*2) throw new Error('오디오 프레임 형식');
      if(this.now()-s.windowAt>=1000) {s.windowAt=this.now();s.windowBytes=0;}
      s.windowBytes+=raw.bytes.byteLength; if(s.windowBytes>rate*2*1.5) throw new Error('오디오 빈도 한도');
      s.inputSequence=raw.sequence;
      if(s.provider==='openai') this.json(s,{type:'input_audio_buffer.append',audio:Buffer.from(raw.bytes).toString('base64')});
      else if(s.provider==='gemini') this.json(s,{realtimeInput:{audio:{data:Buffer.from(raw.bytes).toString('base64'),mimeType:'audio/pcm;rate=16000'}}});
      else this.send(s,raw.bytes);
    } catch { this.finish(s,'error','오디오 형식·빈도 또는 전송 큐 한도를 초과해 종료했습니다.'); }
  }
  control(raw:unknown):void {
    keys(raw,['id','type','muted','sequence','playedSamples','interruption','playedMs']); const s=this.require(raw.id);
    try {
      if(raw.type==='received'){keys(raw,['id','type','sequence']);if(!Number.isSafeInteger(raw.sequence)||!s.deliveries.has(raw.sequence))throw new Error();s.deliveries.delete(raw.sequence);}
      else if(raw.type==='mute') {
        keys(raw,['id','type','muted']);
        if(typeof raw.muted!=='boolean'||s.state!=='active') throw new Error(); s.muted=raw.muted;
        if(s.provider==='gemini' && s.muted)this.json(s,{realtimeInput:{audioStreamEnd:true}});
      } else if(raw.type==='played') {
        keys(raw,['id','type','sequence','playedSamples']);
        if(Number.isSafeInteger(raw.sequence)&&raw.sequence>0&&raw.sequence<=s.discardedThrough)return;
        const o=s.outputs.get(raw.sequence);
        if(!o||!Number.isSafeInteger(raw.playedSamples)||raw.playedSamples<0||raw.playedSamples>o.samples) throw new Error();
        if(o.itemId===s.itemId) s.playedSamples+=raw.playedSamples; s.outputs.delete(raw.sequence);
      } else if(raw.type==='interrupted') {
        keys(raw,['id','type','interruption','playedMs']);
        if(!s.awaitingInterrupt||raw.interruption!==s.interruption||!Number.isSafeInteger(raw.playedMs)||raw.playedMs<0||raw.playedMs>Math.floor(s.itemSamples/24)) throw new Error();
        if(s.itemId) this.json(s,{type:'conversation.item.truncate',item_id:s.itemId,content_index:0,audio_end_ms:raw.playedMs});
        s.awaitingInterrupt=false; s.discardedThrough=s.outputSequence;s.outputs.clear();
      } else throw new Error();
    } catch { this.finish(s,'error','음성 제어 형식 또는 큐 한도를 확인해 주세요.'); }
  }
  stop(id:unknown, immediate=false):void {
    voiceId(id);if(immediate && this.completed?.id===id)this.completed=undefined;
    const s=this.current; if(!s||s.id!==id)return;
    if(immediate) return this.abort();
    if(s.state==='stopping')return;
    if(s.provider==='soniox'&&s.state==='active') {
      this.state(s,'stopping');clearInterval(s.keepalive);clearTimeout(s.timer);
      try {this.send(s,'');s.timer=setTimeout(()=>this.finish(s,'closed','최종 확정 응답 대기 시간이 초과됐습니다. 수신된 확정문만 사용해 주세요.'),5000);}
      catch {this.finish(s,'error','받아쓰기 종료 프레임을 전송하지 못했습니다.');}return;
    }
    this.state(s,'stopping');this.finish(s,'closed','음성 세션을 종료했습니다. 사용량은 Gateway에서 정산합니다.');
  }
  abort():void { const s=this.current; this.completed=undefined; if(s) this.finish(s,'closed','음성 세션을 중단했습니다.',false); }
  private finish(s:Session,state:'closed'|'error',message:string,retain=true) {
    if(this.current!==s)return;
    if(this.owned(s)) {
      if(retain && s.final) this.completed={identity:{epoch:s.epoch,profileId:s.profileId,owner:s.owner},id:s.id,modelId:s.modelId,text:s.final,claimed:false};
      this.state(s,state,message);
    }
    this.current=undefined; s.controller.abort();clearTimeout(s.timer);clearInterval(s.keepalive);
    s.outputs.clear();s.deliveries.clear(); s.final='';s.provisional='';
    const socket=s.socket;
    if(socket) {
      socket.removeAllListeners();
      if(socket.readyState===WebSocket.CLOSED)return;
      socket.on('error',()=>{});
      const timer=setTimeout(()=>socket.terminate(),1000);timer.unref();
      socket.on('close',()=>{clearTimeout(timer);socket.removeAllListeners();});
      if(socket.readyState===WebSocket.OPEN)socket.close(1000);else socket.terminate();
    }
  }
  claimText(id:unknown): VoiceTextClaim {
    voiceId(id);const c=this.completed;const i=this.deps.identity();
    if(!c||c.id!==id||c.claimed||c.reservation||c.identity.epoch!==i.epoch||c.identity.profileId!==i.profileId||c.identity.owner!==i.owner) throw new Error('저장 가능한 현재 계정의 확정 음성 문장이 없습니다.');
    const reservation={};c.reservation=reservation;
    const owned=()=>{const current=this.deps.identity();return this.completed===c &&
      c.identity.epoch===current.epoch && c.identity.profileId===current.profileId && c.identity.owner===current.owner;};
    return {modelId:c.modelId,text:c.text,identity:{...c.identity},
      assertCurrent:()=>{if(!owned()||c.reservation!==reservation)throw new Error('음성 세션 또는 계정이 변경되어 저장 결과를 적용하지 않았습니다.');},
      // A stale completion may neither consume nor release a replacement session's claim.
      commit:()=>{if(owned()&&c.reservation===reservation)c.claimed=true;},
      rollback:()=>{if(owned()&&c.reservation===reservation&&!c.claimed)c.reservation=undefined;}};
  }
  private text(s:Session,final:string,provisional='') { if(final.length+provisional.length>VOICE_TEXT_LIMIT) throw new Error();s.final=final;s.provisional=provisional;this.event(s,{type:'text',final,provisional} as EventBody); }
  private audio(s:Session,base64:unknown,itemId?:string) {
    if(typeof base64!=='string'||base64.length>VOICE_MESSAGE_LIMIT||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error();
    const bytes=Buffer.from(base64,'base64'); if(!bytes.length||bytes.length%2||bytes.length>VOICE_MESSAGE_LIMIT) throw new Error();
    if(itemId && s.blockedItems.has(itemId))return;
    if(s.awaitingInterrupt)return;
    if(itemId!==s.itemId){s.itemId=itemId;s.itemSamples=0;s.playedSamples=0;}
    let queued=[...s.outputs.values()].reduce((n,o)=>n+o.samples,0);if(queued+bytes.length/2>VOICE_QUEUE_SAMPLES)throw new Error();
    for(let at=0;at<bytes.length;at+=24000){const chunk=bytes.subarray(at,at+24000); const seq=++s.outputSequence;
      s.outputs.set(seq,{samples:chunk.length/2,itemId});s.itemSamples+=chunk.length/2;
      this.event(s,{type:'audio',sequence:seq,bytes:new Uint8Array(chunk),sampleRate:24000,...(itemId?{itemId}:{})} as EventBody);}
  }
  private interrupt(s:Session) {
    s.interruption++;s.awaitingInterrupt=s.provider==='openai' && !!s.itemId;
    if(s.itemId){if(s.blockedItems.size>=128)throw new Error();s.blockedItems.add(s.itemId);}
    // server_vad interrupt_response cancels server generation; no duplicate cancel on an already canceled response.
    this.event(s,{type:'interrupt',interruption:s.interruption,...(s.provider==='openai'&&s.itemId?{itemId:s.itemId}:{})} as EventBody);
    if(!s.awaitingInterrupt){s.discardedThrough=s.outputSequence;s.outputs.clear();}
    this.event(s,{type:'activity',activity:'listening'} as EventBody);
  }
  private receive(s:Session,data:WebSocket.RawData,isBinary:boolean) {
    const bytes=Array.isArray(data)?Buffer.concat(data):Buffer.from(data as ArrayBuffer);
    if(bytes.length>VOICE_MESSAGE_LIMIT)throw new Error();
    if(this.now()-s.receiveAt>=1000){s.receiveAt=this.now();s.receiveBytes=0;s.receiveCount=0;}
    s.receiveBytes+=bytes.length;s.receiveCount++;if(s.receiveBytes>1024*1024||s.receiveCount>200)throw new Error();
    // Gemini may deliver JSON in binary WS messages. No provider sends raw PCM as a top-level server frame.
    const e:unknown=JSON.parse(bytes.toString('utf8'));if(!record(e))throw new Error();
    if(e.error_code){const code=Number(e.error_code);return this.finish(s,'error',code===408?'받아쓰기 입력 대기 시간이 초과됐습니다.':code===429?'받아쓰기 요청 또는 동시 세션이 제한됐습니다.':code===401||code===403?'받아쓰기 계정 권한 또는 인증이 거절됐습니다.':'받아쓰기 제공사가 요청을 거절했습니다.');}
    if(e.type==='error'||e.error) return this.finish(s,'error','음성 제공사가 요청을 거절했습니다. 자동 재시도하지 않습니다.');
    if(s.provider==='openai') {
      if(e.type==='session.updated') {if(s.state!=='connecting')return;clearTimeout(s.timer);this.state(s,'active');return;}
      if(s.state!=='active')return;
      if(e.type==='input_audio_buffer.speech_started')this.interrupt(s);
      if(e.type==='response.output_audio.delta') {if(typeof e.item_id!=='string'||e.item_id.length>256)throw new Error();this.audio(s,e.delta,e.item_id);this.event(s,{type:'activity',activity:'responding'} as EventBody);}
      if(e.type==='conversation.item.input_audio_transcription.completed') {if(typeof e.transcript!=='string')throw new Error();this.text(s,s.final+'나: '+e.transcript+'\n');}
      if(e.type==='response.output_audio_transcript.delta'&&!s.blockedItems.has(e.item_id)){if(typeof e.delta!=='string')throw new Error();this.text(s,s.final,s.provisional+e.delta);}
      if(e.type==='response.output_audio_transcript.done'&&!s.blockedItems.has(e.item_id)){if(typeof e.transcript!=='string')throw new Error();this.text(s,s.final+'AI: '+e.transcript+'\n');}
      if(e.type==='response.done') {if(e.response?.status==='failed')return this.finish(s,'error','음성 응답이 실패했습니다.');this.event(s,{type:'activity',activity:'listening'} as EventBody);}
      if(typeof e.type==='string'&&e.type.startsWith('response.function_call')||e.item?.type==='function_call'||Array.isArray(e.response?.output)&&e.response.output.some((item:unknown)=>record(item)&&item.type==='function_call'))this.finish(s,'error','이 음성 화면은 도구 실행을 지원하지 않습니다.');
    } else if(s.provider==='gemini') {
      if(record(e.setupComplete)){if(s.state!=='connecting')return;clearTimeout(s.timer);this.state(s,'active');return;}
      if(e.toolCall || e.toolCallCancellation)return this.finish(s,'error','이 음성 화면은 Gemini 도구 실행을 지원하지 않습니다.');
      if(s.state!=='active')return;
      if(e.goAway)return this.finish(s,'closed','Gemini 세션 종료가 안내됐습니다. 다시 사용하려면 새로 시작해 주세요.');
      const content=e.serverContent;if(!record(content))return;
      if(content.interrupted){this.interrupt(s);s.geminiInput='';s.geminiOutput='';this.text(s,s.final);}
      if(content.interactionStatus==='IN_PROGRESS'||content.interactionStatus==='IDLE')s.interaction=content.interactionStatus;
      if(content.modelTurn){
        if(!record(content.modelTurn)||!Array.isArray(content.modelTurn.parts)||content.modelTurn.parts.length>64)throw new Error();
        for(const part of content.modelTurn.parts){if(!record(part))throw new Error();if(part.functionCall)return this.finish(s,'error','이 음성 화면은 Gemini 도구 실행을 지원하지 않습니다.');
          if(part.inlineData){if(!record(part.inlineData)||part.inlineData.mimeType!=='audio/pcm;rate=24000')throw new Error();this.audio(s,part.inlineData.data);}}
        this.event(s,{type:'activity',activity:'responding'} as EventBody);
      }
      if(content.inputTranscription){if(typeof content.inputTranscription.text!=='string')throw new Error();s.geminiInput+=content.inputTranscription.text;}
      if(content.outputTranscription){if(typeof content.outputTranscription.text!=='string')throw new Error();s.geminiOutput+=content.outputTranscription.text;}
      this.text(s,s.final,(s.geminiInput?'나: '+s.geminiInput+'\n':'')+(s.geminiOutput?'AI: '+s.geminiOutput:''));
      if(content.turnComplete){this.text(s,s.final+(s.geminiInput?'나: '+s.geminiInput+'\n':'')+(s.geminiOutput?'AI: '+s.geminiOutput+'\n':''));s.geminiInput='';s.geminiOutput='';
        this.event(s,{type:'activity',activity:s.modelId.endsWith('extended-thinking') && s.interaction!=='IDLE'?'thinking':'listening'} as EventBody);}
      else if(content.interactionStatus==='IN_PROGRESS')this.event(s,{type:'activity',activity:'thinking'} as EventBody);
    } else {
      if(s.state!=='active'&&s.state!=='stopping')return;
      if(!Array.isArray(e.tokens)||e.tokens.length>2048||!Number.isFinite(e.final_audio_proc_ms)||!Number.isFinite(e.total_audio_proc_ms)||
        e.final_audio_proc_ms<0||e.total_audio_proc_ms<e.final_audio_proc_ms)throw new Error();
      let finalized=s.final, provisional='';
      for(const token of e.tokens){
        if(!record(token)||typeof token.text!=='string'||token.text.length>2048||typeof token.is_final!=='boolean')throw new Error();
        const text=token.text.replace(/<end>|<fin>/g,'');
        if(token.is_final) {
          let coordinate:string|undefined;
          if(token.start_ms!==undefined||token.end_ms!==undefined){
            if(!Number.isFinite(token.start_ms)||!Number.isFinite(token.end_ms)||token.start_ms<0||token.end_ms<token.start_ms)throw new Error();
            coordinate=JSON.stringify([token.start_ms,token.end_ms,token.text]);
          }
          if(coordinate&&s.sonioxFinals.has(coordinate))continue;
          if(coordinate){if(s.sonioxFinals.size>=8192)throw new Error();s.sonioxFinals.add(coordinate);}
          finalized+=text;
        }else provisional+=text;
      }
      this.text(s,finalized,e.finished===true?'':provisional);
      if(e.finished===true){s.sonioxFinished=true;this.finish(s,'closed','받아쓰기 확정문 수신을 완료했습니다. 사용량은 Gateway에서 정산합니다.');}
    }
  }
}
