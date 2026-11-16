// Optional language models run here, on the visitor's device.
// Only public model assets are fetched. Conversation text never goes to a model API.
let engine=null,generator=null,transformers=null,stopping=null,busy=false;
const send=(type,values={})=>self.postMessage({type,...values});
const CPU_MODEL='onnx-community/SmolLM2-135M-Instruct-ONNX-MHA';

async function loadCPU(){
  send('progress',{progress:0,text:'Preparing compatibility mode. This smaller AI uses your CPU, with no GPU required.'});
  transformers=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
  // One WASM thread works without cross-origin isolation or SharedArrayBuffer.
  transformers.env.backends.onnx.wasm.numThreads=1;
  transformers.env.backends.onnx.wasm.proxy=false;
  transformers.env.allowLocalModels=false;
  const files=new Map();
  generator=await transformers.pipeline('text-generation',CPU_MODEL,{
    device:'wasm',dtype:'q4',
    progress_callback:p=>{
      if(p.status==='progress'&&p.total){files.set(p.file,{loaded:p.loaded,total:p.total});const rows=[...files.values()];const loaded=rows.reduce((n,f)=>n+f.loaded,0),total=rows.reduce((n,f)=>n+f.total,0);send('progress',{progress:Math.min(.95,loaded/total*.95),text:Math.round(loaded/1048576)+' MB received · Downloading the smaller CPU model.'});}
      else if(p.status==='done')send('progress',{progress:.95,text:'Preparing the smaller model on your CPU. The first setup may take a moment.'});
    }
  });
  stopping=new transformers.InterruptableStoppingCriteria();
  send('ready',{model:CPU_MODEL,label:'SmolLM2 · 135M',backend:'CPU'});
}

async function loadGPU(adapter){
  const {CreateMLCEngine,prebuiltAppConfig}=await import('https://esm.run/@mlc-ai/web-llm@0.2.88');
  const model=adapter.features.has('shader-f16')?'Qwen2.5-0.5B-Instruct-q4f16_1-MLC':'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
  // IndexedDB works in embedded browsers where Cache.add rejects large assets.
  engine=await CreateMLCEngine(model,{appConfig:{...prebuiltAppConfig,cacheBackend:'indexeddb'},initProgressCallback:p=>send('progress',{progress:p.progress,text:p.text}),logLevel:'ERROR'},{context_window_size:4096});
  send('ready',{model,label:'Qwen 2.5 · 0.5B',backend:'WebGPU'});
}

self.onmessage=async({data})=>{
  try{
    if(data.type==='load'){
      const adapter=data.forceCPU?null:await navigator.gpu?.requestAdapter().catch(()=>null);
      if(!adapter){await loadCPU();return;}
      try{await loadGPU(adapter);}catch(error){
        if(!/device|webgpu|shader|out of memory|GPUOutOfMemory|buffer.*size/i.test(String(error?.message||error)))throw error;
        await engine?.unload().catch(()=>{});engine=null;
        await loadCPU();
      }
    }else if(data.type==='chat'){
      if(busy){send('error',{message:'A reply is already running. Stop or finish it before starting another.'});return;}
      if(!engine&&!generator)throw new Error('The model is not ready for a new message.');
      busy=true;let text='';
      if(generator){
        stopping.reset();
        const streamer=new transformers.TextStreamer(generator.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:chunk=>{text+=chunk;send('token',{text});}});
        const output=await generator(data.messages,{max_new_tokens:160,do_sample:false,repetition_penalty:1.1,streamer,stopping_criteria:stopping});
        if(!text){const generated=output?.[0]?.generated_text;text=Array.isArray(generated)?generated.at(-1)?.content||'':String(generated||'');}
      }else{
        const stream=await engine.chat.completions.create({messages:data.messages,stream:true,max_tokens:320,temperature:.6,repetition_penalty:1.1});
        for await(const chunk of stream){text+=chunk.choices[0]?.delta?.content||'';send('token',{text});}
      }
      busy=false;send('done',{text});
    }else if(data.type==='stop'){engine?.interruptGenerate();stopping?.interrupt();}
  }catch(error){busy=false;send('error',{message:String(error?.message||error).slice(0,500)});}
};
