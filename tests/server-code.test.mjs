import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderRequest, ProviderEventNormalizer } from '../src/shared/provider-adapters.ts';
import { validatedAdvancedSettings } from '../src/shared/request-validation.ts';
import { ServerCodeNormalizer, CODE_BILLING_NOTICE, serverCodeProvider, sanitizeServerCode, settleServerCode } from '../src/shared/server-code.ts';
import { serializeThreadMarkdown } from '../src/shared/thread-export.ts';
const model = id => ({ id, type: 'llm' });
const build = (id, advanced = {}) => buildProviderRequest({ model:model(id), messages:[{role:'user',content:'synthetic calculation'}], advanced, reasoningMode:'auto' });
const tool = { name:'synthetic_metric',parameters:{type:'object',properties:{},required:[],additionalProperties:false} };
test('default off, exact reviewed models, minimum notice and strict opt-in validation',()=>{
  assert.equal(build('gpt-6-astra').path,'/chat/completions/');
  assert.equal(build('claude-sonnet-5').body.tools,undefined);
  assert.match(CODE_BILLING_NOTICE,/Claude 최소 5분.*OpenAI 최소 15분.*토큰/);
  for(const id of ['gpt-future','gemini-3.8-flash','claude-sonnet-6','gpt-5.6-sol-extra']) {
    assert.equal(serverCodeProvider(model(id)),undefined);assert.throws(()=>build(id,{serverCode:true}),/미확인/);
  }
  assert.throws(()=>validatedAdvancedSettings({serverCode:'true'}));
  assert.deepEqual(validatedAdvancedSettings({serverCode:true}),{serverCode:true});
});
test('Claude beta header and Responses auto container coexist with native web, manual functions and chaining',()=>{
  const claude = build('claude-sonnet-5',{serverCode:true,tools:[tool],claudeThinking:{mode:'off'}});
  assert.equal(claude.path,'/claude/v1/messages/');assert.match(claude.headers['anthropic-beta'],/code-execution-2025-08-25/);
  assert.deepEqual(claude.body.tools[1],{type:'code_execution_20250825',name:'code_execution'});
  assert.equal(claude.body.betas,undefined);assert.equal(claude.body['anthropic-beta'],undefined);
  assert.throws(()=>build('claude-sonnet-5',{serverCode:true,tools:[tool]}),/사고 모드/);
  const open = buildProviderRequest({model:{...model('gpt-6-astra'),searchCapability:{status:'supported',provider:'responses'}},
    messages:[{role:'user',content:'synthetic'}],advanced:{serverCode:true,tools:[tool],responses:{chain:true}},reasoningMode:'auto',previousResponseId:'resp_synthetic',nativeSearch:'responses'});
  assert.deepEqual(open.body.tools.map(x=>x.type),['function','web_search','code_interpreter']);
  assert.deepEqual(open.body.tools.at(-1).container,{type:'auto'});assert.equal(open.body.previous_response_id,'resp_synthetic');
});
test('Claude streamed server execution input, result/error/artifacts remain separate from text and manual functions',()=>{
  const n = new ProviderEventNormalizer('claude');const events=[];const accept=e=>events.push(...n.accept(e));
  accept({type:'content_block_start',index:0,content_block:{type:'server_tool_use',id:'srv_synthetic',name:'bash_code_execution'}});
  accept({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"command":"python synthetic.py"}'}});
  accept({type:'content_block_stop',index:0});
  accept({type:'content_block_start',index:1,content_block:{type:'bash_code_execution_tool_result',tool_use_id:'srv_synthetic',content:{type:'bash_code_execution_result',stdout:'42',stderr:'',return_code:0,content:[{file_id:'file_synthetic',url:'https://example.org/secret'}]}}});
  let r=events.filter(e=>e.type==='server_code').at(-1).result;assert.equal(r.status,'completed');assert.equal(r.stdout,'42');assert.equal(r.code,'python synthetic.py');assert.deepEqual(r.artifacts,[{kind:'file',id:'file_synthetic'}]);
  accept({type:'content_block_start',index:2,content_block:{type:'bash_code_execution_tool_result',tool_use_id:'srv_synthetic',content:{type:'bash_code_execution_tool_result_error',error_code:'unavailable'}}});
  assert.equal(events.at(-1).result.status,'failed');assert.match(events.at(-1).result.summary,/unavailable/);
  accept({type:'content_block_start',index:3,content_block:{type:'tool_use',id:'manual_synthetic',name:tool.name}});
  accept({type:'content_block_delta',index:3,delta:{type:'input_json_delta',partial_json:'{}'}});accept({type:'content_block_stop',index:3});
  assert.equal(events.at(-1).type,'tool_call');
  accept({type:'message_delta',delta:{stop_reason:'pause_turn'}});assert.equal(events.at(-1).continuationUnsupportedReason,'claude_pause_turn');
  assert.equal(events.some(e=>e.type==='text'),false);
});
test('Responses item_id status/code delta/done and final logs images null correctly merge without leaking URLs',()=>{
  const n=new ProviderEventNormalizer('responses');const run=e=>n.accept(e).filter(e=>e.type==='server_code').at(-1)?.result;
  assert.equal(run({type:'response.code_interpreter_call.in_progress',item_id:'ci_synthetic',output_index:4}).status,'executing');
  run({type:'response.code_interpreter_call_code.delta',item_id:'ci_synthetic',delta:'print('});
  assert.equal(run({type:'response.code_interpreter_call_code.done',item_id:'ci_synthetic',code:'print(42)'}).code,'print(42)');
  run({type:'response.code_interpreter_call.interpreting',item_id:'ci_synthetic'});
  run({type:'response.code_interpreter_call.completed',item_id:'ci_synthetic'});
  const r=run({type:'response.output_item.done',item:{type:'code_interpreter_call',id:'ci_synthetic',status:'completed',code:null,container_id:'private-container',outputs:[{type:'logs',logs:'42'},{type:'image',url:'https://example.org/signed?token=synthetic'}]}});
  assert.equal(r.code,'print(42)');assert.equal(r.outputLogs,'42');assert.deepEqual(r.artifacts,[{kind:'image'}]);assert.doesNotMatch(JSON.stringify(r),/token|private-container|https/);
  assert.equal(run({type:'response.completed',response:{output:[{type:'code_interpreter_call',id:'ci_synthetic',status:'completed',code:null,outputs:null}]}}).outputLogs,'42');
  const failed=run({type:'response.output_item.done',item:{type:'code_interpreter_call',id:'ci_failed',status:'failed'}});assert.equal(failed.status,'failed');
});
test('nonstream provider results, bounded normalized persistence/export and cancelled execution',()=>{
  const n=new ProviderEventNormalizer('claude');const r=n.accept({content:[{type:'server_tool_use',id:'srv_test',name:'text_editor_code_execution',input:{command:'create',file_text:'synthetic'}},{type:'text_editor_code_execution_tool_result',tool_use_id:'srv_test',content:{type:'text_editor_code_execution_create_result',is_file_update:false}}]}).at(-1).result;
  assert.equal(r.status,'completed');
  const clean=sanitizeServerCode([{...r,code:'x'.repeat(9000),token:'synthetic-secret',container:{},artifacts:[{kind:'file',id:'file_test',url:'https://example.org/private'}]}]);
  assert.equal(clean[0].code.length,8192);assert.doesNotMatch(JSON.stringify(clean),/token|container|https/);
  assert.equal(settleServerCode([{...r,status:'executing'}],'cancelled','synthetic abort')[0].status,'cancelled');
  const exportText=serializeThreadMarkdown({title:'synthetic',modelId:'claude-sonnet-5',createdAt:'now',updatedAt:'now',messages:[{role:'assistant',text:'',createdAt:'now',serverCodeResults:clean}]});
  assert.match(exportText,/서버 코드 실행/);assert.doesNotMatch(exportText,/synthetic-secret|https/);
});
test('Responses documented container file citations become safe metadata without URLs or container leakage',()=>{
  const n=new ProviderEventNormalizer('responses');
  const events=n.accept({object:'response',status:'completed',output:[{type:'code_interpreter_call',id:'ci_file',container_id:'cntr_synthetic',code:'synthetic',status:'completed',outputs:null},
    {type:'message',content:[{type:'output_text',text:'synthetic file',annotations:[{type:'container_file_citation',container_id:'cntr_synthetic',file_id:'file_synthetic',filename:'synthetic.csv',url:'https://example.org/secret'}]}]}]});
  const r=events.filter(e=>e.type==='server_code').at(-1).result;
  assert.deepEqual(r.artifacts,[{kind:'file',id:'file_synthetic',name:'synthetic.csv'}]);assert.doesNotMatch(JSON.stringify(r),/cntr_|url|https/);
});

test('M1: ninth and later results are omitted and counted instead of throwing; earlier ones keep updating',()=>{
  const n=new ServerCodeNormalizer('claude');
  for(let i=0;i<12;i++){
    const out=n.accept({type:'content_block_start',index:i,content_block:{type:'server_tool_use',id:`srv_${i}`,name:'bash_code_execution',input:{command:`echo ${i}`}}});
    assert.equal(out.length,i<8?1:0);
  }
  assert.equal(n.omittedCount,4);
  assert.deepEqual(n.accept({type:'content_block_start',index:20,content_block:{type:'bash_code_execution_tool_result',tool_use_id:'srv_9',content:{type:'bash_code_execution_result',stdout:'x',stderr:'',return_code:0}}}),[]);
  const again=n.accept({type:'content_block_start',index:21,content_block:{type:'bash_code_execution_tool_result',tool_use_id:'srv_0',content:{type:'bash_code_execution_result',stdout:'ok',stderr:'',return_code:0}}});
  assert.equal(again[0].stdout,'ok');assert.equal(n.omittedCount,4);
  const r=new ServerCodeNormalizer('responses');let last=[];
  for(let i=0;i<12;i++) last=r.accept({type:'response.output_item.done',item:{type:'code_interpreter_call',id:`ci_${i}`,status:'completed',code:'x',outputs:null}});
  assert.deepEqual(last,[]);assert.equal(r.omittedCount,4);
});
test('L6: code, stdout, stderr and logs are exported inside fences longer than any backtick run',()=>{
  const hostile='### 제목\n> 인용\n```';
  const text=serializeThreadMarkdown({title:'synthetic',modelId:'claude-sonnet-5',createdAt:'now',updatedAt:'now',messages:[{role:'assistant',text:'',createdAt:'now',
    serverCodeResults:[{id:'srv_x',provider:'claude',status:'completed',code:'print(1)',stdout:hostile,stderr:'## err',outputLogs:'# log',summary:'ok',artifacts:[]}]}]});
  const lines=text.split('\n');let fence='';const outside=[];
  for(const line of lines){
    if(fence){ if(line===fence) fence=''; continue; }
    const m=/^(`{3,})$/.exec(line); if(m){fence=m[1];continue;} outside.push(line);
  }
  assert.ok(text.includes('````\n### 제목\n> 인용\n```\n````'));
  assert.equal(outside.some(l=>/^(###|##|#|>) ?(제목|인용|err|log)/.test(l)),false);
  assert.equal(fence,'');
});
