import { AudioLines, Lock, Mic, MicOff, Square } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GatewayModel, ThreadSnapshot } from '../../shared/contracts';
import { voiceModels, type VoiceEvent, type VoiceState } from '../../shared/realtime';
import { VoiceAudio } from './voice-audio';
type VoiceOwner = {id:string;target:string;epoch:number;audio:VoiceAudio;unsubscribe:()=>void;live:boolean;stopping:boolean};
type VoiceSave = {id:string;target:string;epoch:number};
const STATES:Record<VoiceState,string>={idle:'시작 전',requesting_permission:'마이크 권한·준비',connecting:'연결 중',active:'마이크 사용 중',stopping:'확정문 수신 중',closed:'종료',error:'오류'};
// Billing, privacy and consent copy is shared by the inline panel and the screen so the two cannot drift apart.
const NOTICE_BILLING='마이크 음성이 외부 AI 제공사로 전송됩니다. 시작 시 1분 비용을 예약하고 사용 중 추가 예약하며 종료 후 실제 사용량을 정산합니다. 음소거는 과금 종료가 아닙니다. 원본 음성은 저장하지 않습니다.';
const NOTICE_PRIVACY='OpenAI·Gemini의 개인정보 필터는 조직 설정에 따라 적용됩니다. Soniox에는 필터가 없습니다. 환자 식별정보·민감정보를 말하지 마세요.';
const CONSENT_SEND='음성 외부 전송·예약 및 실제 과금 안내를 확인하고 동의합니다.';
const CONSENT_SAVE='종료 후 확정 텍스트를 이 대화에 암호화 저장하고 백업에 포함합니다.';
/** `inline` is the collapsible panel inside a conversation; `screen` is the rail screen (settings column + stage). */
export function VoicePanel({models,threadId,canApply,onApply,onSaved,onUsageChanged,variant='inline',threadTitle,headerSearch}:{models:GatewayModel[];threadId:string|null;canApply:boolean;
  onApply:(text:string)=>void;onSaved:(thread:ThreadSnapshot)=>void;onUsageChanged:()=>void;
  variant?:'inline'|'screen';threadTitle?:string;headerSearch?:ReactNode}) {
  const available=voiceModels(models);const [mode,setMode]=useState<'conversation'|'dictation'>('conversation');
  const [model,setModel]=useState(available[0]?.id??'');const [consent,setConsent]=useState(false);const [saveConsent,setSaveConsent]=useState(false);
  const [state,setState]=useState<VoiceState>('idle');const [message,setMessage]=useState('');const [muted,setMuted]=useState(false);
  const [final,setFinal]=useState('');const [provisional,setProvisional]=useState('');const [activity,setActivity]=useState('대기');const [elapsed,setElapsed]=useState(0);
  const [saved,setSaved]=useState(false);const [saving,setSaving]=useState(false);const [playing,setPlaying]=useState(false);
  const owner=useRef<VoiceOwner|null>(null);const starting=useRef(false);const mounted=useRef(true);
  const completedOwner=useRef<VoiceOwner|null>(null);
  const pendingSave=useRef<VoiceSave|null>(null);const savedId=useRef('');const epoch=useRef(0);
  const target=useRef(threadId);target.current=threadId;
  const lastId=useRef('');const finalRef=useRef('');const used=useRef(false);const beginAt=useRef(0);
  const busy=['requesting_permission','connecting','active','stopping'].includes(state);
  function dispose(abort:boolean) {
    const current=owner.current;owner.current=null;starting.current=false;
    if(current){current.live=false;current.audio.close();current.unsubscribe();}
    const completed=completedOwner.current;completedOwner.current=null;completed?.unsubscribe();
    if(abort){epoch.current++;pendingSave.current=null;if(mounted.current)setSaving(false);}
    if(abort && (current?.id||lastId.current))void window.mmllm.stopVoice(current?.id??lastId.current,true).catch(()=>{});
  }
  function ownsSession(current:VoiceOwner) {return mounted.current&&current.live&&owner.current===current&&
    current.target===target.current&&current.epoch===epoch.current;}
  function owns(current:VoiceOwner) {return ownsSession(current)&&!current.stopping;}
  function discardText(text:string) {
    epoch.current++;pendingSave.current=null;finalRef.current='';savedId.current='';
    setFinal('');setProvisional('');setSaveConsent(false);setSaving(false);setSaved(false);setPlaying(false);setMessage(text);
  }
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    lastId.current='';finalRef.current='';savedId.current='';used.current=false;
    setState('idle');setFinal('');setProvisional('');setSaved(false);setSaveConsent(false);setMessage('');setPlaying(false);setActivity('대기');setMuted(false);
    return ()=>dispose(true);
  },[threadId]);
  useEffect(()=>{if(!busy)return;const timer=window.setInterval(()=>setElapsed(Math.floor((Date.now()-beginAt.current)/1000)),1000);return ()=>window.clearInterval(timer);},[busy]);
  function fail(current:VoiceOwner,text:string,stopFailure=false) {if(!(stopFailure?ownsSession(current):owns(current)))return;dispose(true);if(mounted.current){
    if(mode==='conversation')discardText(text);else{setProvisional('');setPlaying(false);setMessage(text);}
    setState('error');setMuted(false);}}
  async function start() {
    if(!threadId||starting.current||owner.current||pendingSave.current||!consent)return;
    const modelId=mode==='dictation'?'stt-rt-v5':model;if(!modelId||mode==='conversation'&&!available.some(m=>m.id===modelId))return;
    dispose(false);
    starting.current=true;used.current=false;savedId.current='';lastId.current=crypto.randomUUID();const id=lastId.current;beginAt.current=Date.now();
    setState('requesting_permission');setElapsed(0);setMessage('');setFinal('');finalRef.current='';setProvisional('');setMuted(false);setSaved(false);setSaveConsent(false);setActivity('듣는 중');setPlaying(false);
    let current:VoiceOwner;
    const audio=new VoiceAudio(id,modelId.startsWith('gemini-')?16000:24000,{
      frame:frame=>owns(current)?window.mmllm.sendVoiceFrame(frame):Promise.resolve(),
      played:(sequence,playedSamples)=>{if(owns(current)){setPlaying(audio.isPlaying);void window.mmllm.controlVoice({id,type:'played',sequence,playedSamples}).catch(()=>fail(current,'음성 재생 상태를 확인하지 못했습니다. 다시 시작해 주세요.'));}},
      failed:()=>fail(current,'음성 처리 또는 전송이 지연됐습니다. 다시 시작해 주세요.'),
      ended:()=>fail(current,'마이크가 끊겼습니다. 장치 연결을 확인하고 다시 시작해 주세요.')
    });
    current={id,target:threadId,epoch:epoch.current,audio,unsubscribe:()=>{},live:true,stopping:false};owner.current=current;
    // One owned subscription; ID checks discard in-flight events from old sessions/accounts.
    current.unsubscribe=window.mmllm.onVoiceEvent((event:VoiceEvent)=>{
      if(!mounted.current||current.target!==target.current||current.epoch!==epoch.current||event.id!==id)return;
      if(event.type==='discard'&&(owner.current===current||completedOwner.current===current)){
        const wasLive=current.live;dispose(false);discardText(event.message);setState('closed');setMuted(false);if(wasLive)onUsageChanged();return;
      }
      if(!ownsSession(current))return;
      if(Number.isSafeInteger(event.delivery))void window.mmllm.controlVoice({id,type:'received',sequence:event.delivery!}).catch(()=>fail(current,'음성 화면 수신을 확인하지 못했습니다. 다시 시작해 주세요.'));
      if(current.stopping&&event.type!=='text'&&!(event.type==='state'&&['stopping','closed','error'].includes(event.state)))return;
      if(event.type==='state') {
        setState(event.state);if(event.message)setMessage(event.message);
        if(event.state==='active')audio.setActive(true);
        if(event.state==='closed'||event.state==='error'){
          // A completed conversation keeps only its claim-invalidation listener;
          // microphone, playback and active callbacks are retired immediately.
          if(mode==='conversation'&&finalRef.current){current.live=false;audio.close();owner.current=null;starting.current=false;completedOwner.current=current;}
          else dispose(false);
          setPlaying(false);setProvisional('');setMuted(false);onUsageChanged();
        }
      } else if(event.type==='audio'){audio.play(event);if(owns(current))setPlaying(audio.isPlaying);}
      else if(event.type==='interrupt'){const playedMs=audio.interrupt(event.itemId);setPlaying(false);if(event.itemId)void window.mmllm.controlVoice({id,type:'interrupted',interruption:event.interruption,playedMs}).catch(()=>fail(current,'재생 중단을 확인하지 못했습니다.'));}
      else if(event.type==='text'){finalRef.current=event.final;setFinal(event.final);setProvisional(event.provisional);}
      else if(event.type==='activity')setActivity(event.activity==='thinking'?'생각 중':event.activity==='responding'?'응답 중':'듣는 중');
    });
    try {
      await window.mmllm.prepareVoice({id,modelId,consent:true});if(!owns(current))return;
      await audio.prepare();if(!owns(current))return;
      setState('connecting');await window.mmllm.connectVoice(id);
    }catch {fail(current,'마이크 권한이 거부됐거나 장치·음성 연결을 준비하지 못했습니다. 설정을 확인하고 다시 시작해 주세요.');}
    finally {if(owns(current))starting.current=false;}
  }
  function stop() {
    const current=owner.current;if(!current||!owns(current))return;
    current.stopping=true;starting.current=false;current.audio.close();setPlaying(false);setState('stopping');void window.mmllm.stopVoice(current.id,false).catch(()=>fail(current,'음성 종료를 확인하지 못했습니다.',true));
  }
  function mute() {const current=owner.current;if(!current||!owns(current)||state!=='active')return;const next=!muted;current.audio.mute(next);setMuted(next);
    void window.mmllm.controlVoice({id:current.id,type:'mute',muted:next}).catch(()=>fail(current,'음소거 상태를 확인하지 못했습니다.'));}
  async function save() {
    if(!threadId||pendingSave.current||savedId.current===lastId.current||saved||!saveConsent||busy||owner.current||starting.current||!canApply||!finalRef.current)return;
    const operation:VoiceSave={id:lastId.current,target:threadId,epoch:epoch.current};
    pendingSave.current=operation;setSaving(true);
    const owned=()=>mounted.current&&pendingSave.current===operation&&epoch.current===operation.epoch&&
      lastId.current===operation.id&&target.current===operation.target;
    try{const result=await window.mmllm.saveVoiceText(operation.id,operation.target,true);
      if(owned()){savedId.current=operation.id;setSaved(true);dispose(false);onSaved(result);}}
    catch{if(owned())setMessage('음성 텍스트를 암호화 저장하지 못했습니다. 현재 계정·대화를 확인해 주세요.');}
    finally{if(pendingSave.current===operation){pendingSave.current=null;if(mounted.current)setSaving(false);}}
  }
  const modelOk=mode==='dictation'||available.some(m=>m.id===model);
  const statusText=`${STATES[state]}${busy?` · ${muted?'마이크 음소거':state==='active'?'● 마이크 켜짐':'마이크 준비·종료 중'} · ${playing?'응답 중':activity} · ${elapsed}초`:''}`;
  if(variant==='screen') return <section className="voice-screen" aria-label="실시간 음성">
    <aside className="voice-settings">
      <div className="voice-settings-title">음성</div>
      {threadId&&<>
        <div className="voice-field"><span className="voice-field-label" id="voice-mode-label">용도</span>
          <div className="voice-mode" role="group" aria-labelledby="voice-mode-label">
            {([['conversation','음성 대화',AudioLines],['dictation','받아쓰기',Mic]] as const).map(([value,label,Icon])=>
              <button type="button" key={value} aria-pressed={mode===value} disabled={busy||saving}
                onClick={()=>{if(pendingSave.current||owner.current||starting.current||mode===value)return;setMode(value);setConsent(false);setFinal('');finalRef.current='';setProvisional('');}}>
                <Icon size={15} aria-hidden="true"/>{label}</button>)}
          </div></div>
        {mode==='conversation'?<div className="voice-field"><label className="voice-field-label" htmlFor="voice-model-select">실시간 모델</label>
          <div className="voice-model"><select id="voice-model-select" aria-label="실시간 음성 모델" value={model} disabled={busy||saving} onChange={e=>{if(pendingSave.current||owner.current||starting.current)return;setModel(e.target.value);setConsent(false);}}>
            {!available.length&&<option value="">사용 가능한 모델 없음</option>}{available.map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</select>
            {busy&&<Lock className="voice-model-lock" size={14} aria-hidden="true"/>}</div>
          {busy&&<small>세션 중에는 바꿀 수 없습니다</small>}</div>
          :<p className="voice-soniox">Soniox stt-rt-v5 · 계정 권한은 시작 시 Gateway에서 확인합니다.</p>}
        <p className="voice-notice voice-notice-billing">{NOTICE_BILLING}</p>
        <p className="voice-notice voice-notice-privacy">{NOTICE_PRIVACY}</p>
        <label className="voice-consent"><input type="checkbox" aria-label="음성 외부 전송과 과금 동의" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>{CONSENT_SEND}</label>
        {mode==='conversation'&&<label className="voice-consent"><input type="checkbox" aria-label="음성 텍스트 암호화 저장 동의" checked={saveConsent} disabled={busy||saved||saving} onChange={e=>setSaveConsent(e.target.checked)}/>{CONSENT_SAVE}</label>}
      </>}
    </aside>
    <div className="voice-main">
      <div className="panel-header voice-header"><div className="panel-heading"><span className="panel-section">음성</span>
        <h2>{threadTitle||'음성'}</h2>{threadId&&threadTitle&&<span className="voice-header-note">에 연결된 음성 세션</span>}</div>{headerSearch}</div>
      {!threadId?<div className="voice-empty"><AudioLines size={28} aria-hidden="true"/><h3>대화를 먼저 선택하세요</h3>
        <p>음성은 선택한 대화에 연결됩니다. 대화를 고른 뒤 이 화면으로 돌아와 주세요.</p></div>
      :<div className="voice-stage">
        <div className="voice-pill" data-state={state}><span role="status" aria-live="polite">{statusText}</span></div>
        <div className="voice-controls">
          {!busy&&<button type="button" className="primary-button voice-start" disabled={saving||!consent||!modelOk} onClick={()=>void start()}>시작</button>}
          {busy&&<>
            <div className="voice-control"><button type="button" className="voice-circle" disabled={state!=='active'} aria-pressed={muted} onClick={mute}>
              {muted?<Mic size={20} aria-hidden="true"/>:<MicOff size={20} aria-hidden="true"/>}<span className="sr-only">{muted?'마이크 다시 켜기':'음소거'}</span></button>
              <span aria-hidden="true">{muted?'마이크 다시 켜기':'음소거'}</span></div>
            <div className="voice-control"><button type="button" className="voice-circle voice-circle-stop" disabled={state==='stopping'} onClick={stop}>
              <Square size={18} aria-hidden="true" fill="currentColor"/><span className="sr-only">종료</span></button>
              <span aria-hidden="true">종료</span></div></>}
        </div>
        {message&&<p className="voice-message" role={state==='error'?'alert':'status'}>{message}</p>}
        {(final||provisional)?<div className="voice-transcript" aria-label="음성 텍스트 미리보기"><div className="voice-transcript-label">실시간 텍스트</div>
          <p>{final}<span className="voice-provisional">{provisional}</span></p></div>
          :<p className="voice-hint">{mode==='dictation'?'세션을 종료하면 확정문을 초안에 추가할 수 있습니다':'세션을 종료하면 텍스트 저장을 선택할 수 있습니다'}</p>}
        {mode==='dictation'&&<button type="button" className="secondary-button" disabled={busy||!final||!canApply||used.current} onClick={()=>{if(used.current)return;used.current=true;onApply(final);setMessage('확정문을 기존 초안 뒤에 추가했습니다. 검토 후 직접 전송해 주세요.');}}>확정문을 초안에 추가</button>}
        {mode==='conversation'&&<button type="button" className="secondary-button" disabled={busy||!final||!saveConsent||saved||saving||!canApply} onClick={()=>void save()}>{saved?'텍스트 저장됨':'텍스트 저장'}</button>}
        {!canApply&&<p className="voice-hint">초안 적용·텍스트 저장은 일반 대화에서 사용해 주세요.</p>}
      </div>}
    </div>
  </section>;
  return <details className="voice-panel" onToggle={event=>{if(!event.currentTarget.open&&lastId.current){dispose(true);setPlaying(false);setMuted(false);setState('closed');
    if(mode==='conversation')discardText('음성 화면을 닫아 세션과 저장하지 않은 확정문을 폐기했습니다. 다시 사용하려면 시작해 주세요.');
    else{setProvisional('');setMessage('음성 화면을 닫아 세션을 중단했습니다. 수신한 확정문은 초안에 직접 추가할 수 있습니다.');}}}}>
    <summary>실시간 음성 · 받아쓰기</summary>
    <div className="voice-content">
      <div className="voice-options"><label>용도<select aria-label="음성 용도" value={mode} disabled={busy||saving} onChange={e=>{if(pendingSave.current||owner.current||starting.current)return;setMode(e.target.value as typeof mode);setConsent(false);setFinal('');finalRef.current='';setProvisional('');}}>
        <option value="conversation">음성 대화</option><option value="dictation">받아쓰기 · Soniox</option></select></label>
        {mode==='conversation'?<label>실시간 모델<select aria-label="실시간 음성 모델" value={model} disabled={busy||saving} onChange={e=>{if(pendingSave.current||owner.current||starting.current)return;setModel(e.target.value);setConsent(false);}}>
          {!available.length&&<option value="">사용 가능한 모델 없음</option>}{available.map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</select></label>:<p>Soniox stt-rt-v5 · 계정 권한은 시작 시 Gateway에서 확인합니다.</p>}</div>
      <p className="voice-notice">{NOTICE_BILLING}</p>
      <p className="voice-notice">{NOTICE_PRIVACY}</p>
      <label className="voice-consent"><input type="checkbox" aria-label="음성 외부 전송과 과금 동의" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>{CONSENT_SEND}</label>
      <div className="voice-actions"><button type="button" className="primary-button" disabled={busy||saving||!consent||mode==='conversation'&&!available.some(m=>m.id===model)} onClick={()=>void start()}>시작</button>
        <button type="button" className="secondary-button" disabled={state!=='active'} aria-pressed={muted} onClick={mute}>{muted?'마이크 다시 켜기':'음소거'}</button>
        <button type="button" className="secondary-button" disabled={!busy||state==='stopping'} onClick={stop}>종료</button>
        <span role="status" aria-live="polite">{STATES[state]}{busy?` · ${muted?'마이크 음소거':state==='active'?'● 마이크 켜짐':'마이크 준비·종료 중'} · ${playing?'응답 중':activity} · ${elapsed}초`:''}</span></div>
      {message&&<p role={state==='error'?'alert':'status'}>{message}</p>}
      {(final||provisional)&&<div className="voice-preview" aria-label="음성 텍스트 미리보기"><p>{final}<span className="voice-provisional">{provisional}</span></p></div>}
      {mode==='dictation'&&<button type="button" className="secondary-button" disabled={busy||!final||!canApply||used.current} onClick={()=>{if(used.current)return;used.current=true;onApply(final);setMessage('확정문을 기존 초안 뒤에 추가했습니다. 검토 후 직접 전송해 주세요.');}}>확정문을 초안에 추가</button>}
      {mode==='conversation'&&<><label className="voice-consent"><input type="checkbox" aria-label="음성 텍스트 암호화 저장 동의" checked={saveConsent} disabled={busy||saved||saving} onChange={e=>setSaveConsent(e.target.checked)}/>{CONSENT_SAVE}</label>
        <button type="button" className="secondary-button" disabled={busy||!final||!saveConsent||saved||saving||!canApply} onClick={()=>void save()}>{saved?'텍스트 저장됨':'텍스트 저장'}</button></>}
      {!canApply&&<p>초안 적용·텍스트 저장은 일반 대화에서 사용해 주세요.</p>}
    </div>
  </details>;
}
