import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guidanceSchema } from '../app/guidance.mjs';
const output=resolve('node_modules/.cache/brinky-response-test.mjs');
await build({entryPoints:['vendor/siwc-local/src/responses.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
const {streamResponse}=await import(pathToFileURL(output).href);
const frame=event=>`data: ${JSON.stringify(event)}\n\n`;
const body=(...events)=>new Response(events.map(frame).join(''),{headers:{'content-type':'text/event-stream'}});
const sample={model:'test-model',input:[{role:'user',content:[{type:'input_text',text:'Where?'},{type:'input_image',image_url:'data:image/jpeg;base64,/9j/2Q==',detail:'high'}]}],textFormat:{type:'json_schema',name:'brinky_step',strict:true,schema:guidanceSchema}};
test('sends screenshot and strict schema to the public Responses endpoint with storage disabled',async t=>{
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(String(url),'https://api.openai.com/v1/responses');
    const sent=JSON.parse(init.body);assert.equal(sent.store,false);assert.equal(sent.stream,true);
    assert.deepEqual(sent.input,sample.input);assert.deepEqual(sent.text.format,sample.textFormat);
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer test-token');
    return body({type:'response.output_text.delta',delta:'{"title":"Add"}'},{type:'response.completed',response:{status:'completed'}});
  });
  assert.equal((await streamResponse('test-token',sample,new AbortController().signal)).text,'{"title":"Add"}');
});
test('does not treat truncated streamed JSON as a completed response',async t=>{
  t.mock.method(globalThis,'fetch',async()=>body({type:'response.output_text.delta',delta:'{"title":"Add"}'}));
  await assert.rejects(streamResponse('test-token',sample,new AbortController().signal),{code:'stream_interrupted'});
});
test('usage-limit failures remain failures even after text starts streaming',async t=>{
  t.mock.method(globalThis,'fetch',async()=>body({type:'response.output_text.delta',delta:'{'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}));
  await assert.rejects(streamResponse('test-token',sample,new AbortController().signal),{code:'subscription_sharing_usage_limit_exceeded'});
});
