import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteBoundWithContext, estimatePayload, estimateFingerprint, normalizeEstimateRequest, parseMediaQuote } from '../src/shared/media-estimate.ts';
import { imageRequestPayload, videoRequestPayload, musicRequestPayload } from '../src/shared/media-capabilities.ts';
const image={kind:'image',modelId:'gpt-image-2',numberOfImages:1,quality:'high',imageSize:'1536x1024',background:'opaque'};
const video={kind:'video',modelId:'fal-ai/vidu/q3',durationSeconds:8,resolution:'1080p',aspectRatio:'16:9',audio:true};
const music={kind:'music',modelId:'elevenlabs-music',durationSeconds:60,instrumental:true};
const wire=(r,bound='exact')=>({object:'estimate',kind:r.kind,model:r.modelId,credits:3.5,exact:bound==='exact',bound,
  lines:[{item:r.kind,credits:3,exact:bound==='exact',bound,basis:'synthetic'},{item:'content_filter',credits:.5,exact:true,bound:'exact',basis:'per_request',note:'synthetic separate filter charge'}]});
test('image/video/music quote options exactly match normalized generation options without private data',()=>{
  const generation=[imageRequestPayload({...image,prompt:'synthetic private',imageAttachmentIds:[],deidentifiedConfirmed:true},[]),
    videoRequestPayload({...video,prompt:'synthetic private',imageAttachmentIds:[],deidentifiedConfirmed:true},[]),
    musicRequestPayload({...music,lane:'music',prompt:'synthetic private',deidentifiedConfirmed:true})];
  [image,video,music].forEach((r,i)=>{const {prompt,...options}=generation[i];assert.deepEqual(estimatePayload(r),{kind:r.kind,...options});assert.doesNotMatch(estimateFingerprint(r),/private|prompt/)});
  assert.deepEqual(estimatePayload(video).parameters,{aspect_ratio:'16:9',duration:8,resolution:'1080p',audio:true});
});
test('all four price bounds preserve exact flags, filter lines and bounded notes',()=>{
  for(const bound of ['exact','minimum','maximum','approximate']) {const response={...wire(image,bound),note:'x'.repeat(3000)};
    const result=parseMediaQuote(response,image,'2026-10-08T00:00:00Z');assert.equal(result.bound,bound);assert.equal(result.exact,bound==='exact');
    assert.equal(result.lines[1].item,'content_filter');assert.equal(result.note.length,2000);assert.equal(result.quotedAt,'2026-10-08T00:00:00Z');}
  const zero=wire(image);zero.credits=0;zero.lines=[{...zero.lines[0],credits:0}];assert.equal(parseMediaQuote(zero,image).credits,0);
});
test('total certainty is compatible with every generation/filter bound, allowing conservative totals without rewriting lines',()=>{
  for(const total of ['exact','minimum','maximum','approximate']) for(const line of ['exact','minimum','maximum','approximate']) {
    const compatible=total==='approximate'||line==='exact'||line===total;
    // Apply uncertainty to either generation or the separately billed filter.
    for(const item of [0,1]) {
      const value=wire(image,total);value.lines=wire(image).lines;
      value.lines[item]={...value.lines[item],bound:line,exact:line==='exact'};
      if(!compatible) assert.throws(()=>parseMediaQuote(value,image),/견적.*확인할 수 없습니다/);
      else {
        const parsed=parseMediaQuote(value,image);assert.equal(parsed.bound,total);assert.equal(parsed.exact,total==='exact');
        assert.equal(parsed.credits,3.5);assert.deepEqual(parsed.lines,value.lines);
      }
    }
  }
  const mixed=wire(image,'approximate');mixed.lines[0].bound='minimum';mixed.lines[1].bound='maximum';mixed.lines[1].exact=false;
  assert.deepEqual(parseMediaQuote(mixed,image).lines,mixed.lines);
});
test('missing/bad/nonfinite/negative price, mismatched model-kind, malformed bounds/lines never become zero',()=>{
  for(const patch of [{credits:undefined},{credits:null},{credits:''},{credits:'0'},{credits:-1},{credits:NaN},{credits:Infinity},
    {model:'other-model'},{kind:'music'},{bound:'guess'},{exact:false},{lines:[]},{lines:wire(image).lines.map(l=>({...l,credits:NaN}))},
    {lines:[{...wire(image).lines[0],item:'video'}]},{credits:4},{lines:Array(17).fill(wire(image).lines[0])}]) assert.throws(()=>parseMediaQuote({...wire(image),...patch},image),/견적/);
});
test('quote input allowlist excludes STT/TTS/search/code and rejects prompts, bytes, references and invalid generation options',()=>{
  for(const kind of ['stt','tts','llm','code','search']) assert.throws(()=>normalizeEstimateRequest({kind,modelId:'synthetic'}));
  for(const extra of ['prompt','lyrics','input_images','input_urls','imageAttachmentIds','bytes','endpoint','apiKey']) assert.throws(()=>normalizeEstimateRequest({...image,[extra]:'synthetic'}));
  assert.throws(()=>normalizeEstimateRequest({...image,numberOfImages:2}));assert.throws(()=>normalizeEstimateRequest({...video,durationSeconds:99}));
});

test('L10: reference images downgrade certainty because they are not sent to the estimate API',()=>{
  const quote=parseMediaQuote(wire(image),image);
  assert.deepEqual(quoteBoundWithContext(quote,{referenceImages:0}),{bound:'exact',label:'확정'});
  assert.deepEqual(quoteBoundWithContext(quote,{referenceImages:1}),{bound:'minimum',label:'참고 이미지 제외 · 최소'});
  const approx=parseMediaQuote(wire(image,'approximate'),image);
  assert.deepEqual(quoteBoundWithContext(approx,{referenceImages:2}),{bound:'approximate',label:'참고 이미지 제외 · 대략'});
  assert.equal(quoteBoundWithContext(parseMediaQuote(wire(image,'maximum'),image),{referenceImages:1}).bound,'maximum');
});
