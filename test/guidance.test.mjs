import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGuidance, targetToRect, makeInput } from '../app/guidance.mjs';
const answer = {title:'Click Add',instruction:'Open the Add menu.',done:false,target:{x:.25,y:.1,width:.1,height:.05,label:'Add'}};
test('maps screenshot coordinates to logical pixels on a scaled, negative-origin display',()=>{
  const rect=targetToRect(answer.target,{x:-1920,y:0,width:1536,height:864});
  assert.deepEqual(rect,{x:384,y:87,width:154,height:43,label:'Add'});
});
test('tiny targets remain visible at the edge of a monitor',()=>{
  const rect=targetToRect({x:.999,y:.999,width:.001,height:.001,label:'edge'},{width:1280,height:720});
  assert.deepEqual(rect,{x:1248,y:688,width:32,height:32,label:'edge'});
});
test('rejects out-of-range and nonfinite targets while preserving spoken guidance',()=>{
  for(const target of [{...answer.target,x:-.1},{...answer.target,x:.99},{...answer.target,width:0},{...answer.target,y:'0.1'}]) {
    const parsed=parseGuidance(JSON.stringify({...answer,target}));assert.equal(parsed.target,null);assert.equal(parsed.instruction,answer.instruction);
  }
});
test('accepts a deliberately uncertain answer without drawing a misleading pointer',()=>{
  assert.equal(parseGuidance(JSON.stringify({...answer,target:null})).target,null);
});
test('requires a complete usable answer',()=>{
  for(const text of ['broken',JSON.stringify({title:'x'}),JSON.stringify({...answer,instruction:''})])assert.throws(()=>parseGuidance(text));
});
test('never carries earlier screenshots into a follow-up',()=>{
  const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:`message ${i}`}));
  const input=makeInput(history,'next','data:image/jpeg;base64,aGVsbG8=');
  assert.equal(input.length,11);assert.equal(input[0].content,'message 10');
  assert.equal(input.at(-1).content[1].type,'input_image');assert.equal(input.at(-1).content[1].detail,'high');
});
