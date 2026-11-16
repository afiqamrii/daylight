import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Run the actual worker message handler while replacing only the remote model imports.
// No model assets, network calls, GPU device, or large allocations are involved.
const source=(await readFile(new URL('../dist/helper-worker.mjs',import.meta.url),'utf8'))
  .replace(/\bimport\(/g,'__modelImport(');

function workerHarness({gpu,forceAdapterError=false,gpuError=null,cpuGenerate=null,cpuError=null,features=['shader-f16']}={}) {
  const messages=[],imports=[],pipelineCalls=[],engineCalls=[],generationCalls=[],criteria=[];
  let adapterCalls=0,gpuInterrupts=0,unloads=0;
  class StoppingCriteria {
    constructor(){this.interrupted=false;this.resets=0;this.interrupts=0;criteria.push(this);}
    reset(){this.interrupted=false;this.resets++;}
    interrupt(){this.interrupted=true;this.interrupts++;}
  }
  class Streamer {
    constructor(tokenizer,options){this.tokenizer=tokenizer;this.options=options;this.emit=options.callback_function;}
  }
  const generator=async(messages,options)=>{
    generationCalls.push({messages,options});
    if(cpuGenerate)return cpuGenerate(messages,options);
    options.streamer.emit('A small ');options.streamer.emit('step.');
    return [{generated_text:[{role:'assistant',content:'A small step.'}]}];
  };
  generator.tokenizer={kind:'test tokenizer'};
  const transformers={
    env:{backends:{onnx:{wasm:{numThreads:8,proxy:true}}},allowLocalModels:true},
    pipeline:async(task,model,options)=>{
      pipelineCalls.push({task,model,options});if(cpuError)throw cpuError;
      options.progress_callback({status:'progress',file:'weights-a',loaded:10,total:20});
      options.progress_callback({status:'progress',file:'weights-b',loaded:10,total:20});
      options.progress_callback({status:'done'});
      return generator;
    },
    InterruptableStoppingCriteria:StoppingCriteria,
    TextStreamer:Streamer,
  };
  const engine={
    unload:async()=>{unloads++;},
    interruptGenerate:()=>{gpuInterrupts++;},
    chat:{completions:{create:async function*(){yield {choices:[{delta:{content:'Hello'}}]};yield {choices:[{delta:{content:' there.'}}]};}}},
  };
  const webllm={
    prebuiltAppConfig:{testConfig:true},
    CreateMLCEngine:async(model,options,settings)=>{engineCalls.push({model,options,settings});if(gpuError)throw gpuError;return engine;},
  };
  const navigator={};
  if(gpu!==undefined)navigator.gpu={requestAdapter:async()=>{adapterCalls++;if(forceAdapterError)throw new Error('Adapter request rejected.');return gpu===null?null:{features:new Set(features)};}};
  const self={postMessage:message=>messages.push(JSON.parse(JSON.stringify(message)))};
  const context=vm.createContext({self,navigator,Map,console,__modelImport:async url=>{
    imports.push(url);
    if(url.includes('@huggingface/transformers'))return transformers;
    if(url.includes('@mlc-ai/web-llm'))return webllm;
    throw new Error(`Unexpected remote import: ${url}`);
  }});
  new vm.Script(source,{filename:'helper-worker.mjs'}).runInContext(context);
  return {send:data=>self.onmessage({data}),messages,imports,pipelineCalls,engineCalls,generationCalls,criteria,transformers,
    get adapterCalls(){return adapterCalls;},get gpuInterrupts(){return gpuInterrupts;},get unloads(){return unloads;}};
}

test('missing navigator.gpu loads CPU compatibility mode with isolated WASM settings',async()=>{
  const worker=workerHarness();await worker.send({type:'load'});
  assert.equal(worker.adapterCalls,0);assert.equal(worker.engineCalls.length,0);
  assert.equal(worker.pipelineCalls.length,1);
  const call=worker.pipelineCalls[0];
  assert.equal(call.task,'text-generation');assert.equal(call.options.device,'wasm');assert.equal(call.options.dtype,'q4');
  assert.match(call.model,/SmolLM2-135M/);
  assert.equal(worker.transformers.env.backends.onnx.wasm.numThreads,1);
  assert.equal(worker.transformers.env.backends.onnx.wasm.proxy,false);
  assert.equal(worker.transformers.env.allowLocalModels,false);
  assert.equal(worker.messages.at(-1).type,'ready');assert.equal(worker.messages.at(-1).backend,'CPU');
  for(const message of worker.messages.filter(value=>value.type==='progress'))assert.ok(message.progress>=0&&message.progress<=1);
});

test('a null or rejected GPU adapter falls back to CPU without importing WebLLM',async()=>{
  for(const config of [{gpu:null},{gpu:true,forceAdapterError:true}]){
    const worker=workerHarness(config);await worker.send({type:'load'});
    assert.equal(worker.adapterCalls,1);assert.equal(worker.pipelineCalls.length,1);
    assert.equal(worker.imports.some(url=>url.includes('web-llm')),false);
    assert.equal(worker.messages.at(-1).backend,'CPU');
    assert.equal(worker.messages.some(value=>value.type==='error'),false);
  }
});

test('forced compatibility mode skips GPU probing even when an adapter exists',async()=>{
  const worker=workerHarness({gpu:true,forceAdapterError:true});await worker.send({type:'load',forceCPU:true});
  assert.equal(worker.adapterCalls,0);assert.equal(worker.engineCalls.length,0);assert.equal(worker.pipelineCalls.length,1);
  assert.equal(worker.messages.at(-1).backend,'CPU');
});

test('CPU generation streams cumulative text then emits exactly one completed reply',async()=>{
  const worker=workerHarness();await worker.send({type:'load'});worker.messages.length=0;
  const prompt=[{role:'system',content:'Be brief.'},{role:'user',content:'What is one small step?'}];
  await worker.send({type:'chat',messages:prompt});
  assert.deepEqual(worker.messages,[{type:'token',text:'A small '},{type:'token',text:'A small step.'},{type:'done',text:'A small step.'}]);
  const call=worker.generationCalls[0];assert.deepEqual(call.messages,prompt);
  assert.equal(call.options.max_new_tokens,160);assert.equal(call.options.do_sample,false);
  assert.equal(call.options.streamer.options.skip_prompt,true);assert.equal(call.options.streamer.options.skip_special_tokens,true);
  assert.equal(call.options.stopping_criteria,worker.criteria[0]);assert.equal(worker.criteria[0].resets,1);
});

test('CPU generation uses the returned assistant content when no stream callback fires',async()=>{
  const worker=workerHarness({cpuGenerate:async()=>[{generated_text:[{role:'user',content:'Hello'},{role:'assistant',content:'A quiet hello.'}]}]});
  await worker.send({type:'load'});worker.messages.length=0;
  await worker.send({type:'chat',messages:[{role:'user',content:'Hello'}]});
  assert.deepEqual(worker.messages,[{type:'done',text:'A quiet hello.'}]);
});

test('stop interrupts CPU generation, preserves partial text and allows a later message',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const worker=workerHarness({cpuGenerate:async(messages,options)=>{
    options.streamer.emit('One');await gate;
    if(!options.stopping_criteria.interrupted)options.streamer.emit(' more step.');
    return [];
  }});
  await worker.send({type:'load'});worker.messages.length=0;
  const pending=worker.send({type:'chat',messages:[{role:'user',content:'Help me begin'}]});
  await worker.send({type:'stop'});assert.equal(worker.criteria[0].interrupts,1);
  release();await pending;
  assert.deepEqual(worker.messages,[{type:'token',text:'One'},{type:'done',text:'One'}]);
  worker.messages.length=0;
  await worker.send({type:'chat',messages:[{role:'user',content:'Try again'}]});
  assert.equal(worker.criteria[0].resets,2);assert.equal(worker.criteria[0].interrupted,false);
  assert.equal(worker.messages.at(-1).text,'One more step.');
});

test('rejecting an overlapping chat keeps later chats blocked until the active reply finishes',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const worker=workerHarness({cpuGenerate:async(messages,options)=>{
    options.streamer.emit('Still working.');await gate;return [];
  }});
  await worker.send({type:'load'});worker.messages.length=0;
  const first=worker.send({type:'chat',messages:[{role:'user',content:'First message'}]});
  await worker.send({type:'chat',messages:[{role:'user',content:'Second message'}]});
  await worker.send({type:'chat',messages:[{role:'user',content:'Third message'}]});
  assert.equal(worker.generationCalls.length,1,'only the first request may enter the generator');
  const errors=worker.messages.filter(message=>message.type==='error');
  assert.equal(errors.length,2);for(const error of errors)assert.match(error.message,/already running/);
  assert.equal(worker.messages.some(message=>message.type==='done'),false);
  release();await first;
  assert.equal(worker.messages.at(-1).type,'done');
  await worker.send({type:'chat',messages:[{role:'user',content:'After the first finishes'}]});
  assert.equal(worker.generationCalls.length,2,'a later request may run after completion');
  assert.equal(worker.messages.at(-1).type,'done');
});

test('GPU shader/device failures retry on CPU, while network errors remain errors',async()=>{
  for(const message of ['Shader compilation failed.','WebGPU device lost.','GPUOutOfMemoryError: allocation failed.','Requested buffer exceeds maximum size.']){
    const worker=workerHarness({gpu:true,gpuError:new Error(message)});await worker.send({type:'load'});
    assert.equal(worker.engineCalls.length,1);assert.equal(worker.pipelineCalls.length,1,message);
    assert.equal(worker.messages.at(-1).type,'ready');assert.equal(worker.messages.at(-1).backend,'CPU');
  }
  const worker=workerHarness({gpu:true,gpuError:new Error('Failed to fetch model weights: network unavailable.')});
  await worker.send({type:'load'});
  assert.equal(worker.engineCalls.length,1);assert.equal(worker.pipelineCalls.length,0);
  assert.equal(worker.messages.at(-1).type,'error');assert.match(worker.messages.at(-1).message,/network unavailable/);
});

test('an available GPU selects its supported shader model and uses IndexedDB caching',async()=>{
  for(const [features,suffix] of [[['shader-f16'],'q4f16_1-MLC'],[[],'q4f32_1-MLC']]){
    const worker=workerHarness({gpu:true,features});await worker.send({type:'load'});
    assert.equal(worker.pipelineCalls.length,0);assert.ok(worker.engineCalls[0].model.endsWith(suffix));
    assert.equal(worker.engineCalls[0].options.appConfig.cacheBackend,'indexeddb');
    assert.equal(worker.engineCalls[0].settings.context_window_size,4096);
    assert.equal(worker.messages.at(-1).backend,'WebGPU');
  }
});

test('CPU initialization failures report an error instead of claiming readiness',async()=>{
  const worker=workerHarness({cpuError:new Error('Model download interrupted.')});await worker.send({type:'load'});
  assert.equal(worker.messages.at(-1).type,'error');assert.match(worker.messages.at(-1).message,/download interrupted/);
  assert.equal(worker.messages.some(value=>value.type==='ready'),false);
});
