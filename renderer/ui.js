const $ = id => document.getElementById(id);
let current, lastModels='', lastDisplays='';
let flowDraft, flowSendTimer, flowValueTimer;
function syncFlow(state) {
  if (!state.flow) { clearTimeout(flowSendTimer); clearInterval(flowValueTimer); flowDraft=undefined; return; }
  if (flowDraft?.id !== state.flow.id) {
    clearTimeout(flowSendTimer); clearInterval(flowValueTimer); flowDraft={id:state.flow.id,changed:false,submitted:false,lastValue:$('prompt').value};
    const id=state.flow.id; tab('guide'); $('prompt').focus();
    setTimeout(()=>{
      if(flowDraft?.id!==id)return;
      $('prompt').focus();
      call('flow-ready',{id,empty:!$('prompt').value.trim(),focused:document.hasFocus()&&document.activeElement===$('prompt')});
    },100);
    // Some accessibility-based insertions update the field without a DOM input event.
    flowValueTimer=setInterval(()=>{
      if(flowDraft?.id!==id||flowDraft.submitted)return;
      if($('prompt').value!==flowDraft.lastValue){flowDraft.lastValue=$('prompt').value;flowDraft.changed=true;scheduleFlowSend();}
    },120);
  }
  scheduleFlowSend();
}
function scheduleFlowSend() {
  clearTimeout(flowSendTimer);
  if(!flowDraft?.changed||flowDraft.submitted||current?.flow?.phase!=='transcribing')return;
  const id=flowDraft.id;
  flowSendTimer=setTimeout(async()=>{
    if(flowDraft?.id!==id||flowDraft.submitted||current?.flow?.phase!=='transcribing')return;
    if(!document.hasFocus()||document.activeElement!==$('prompt')){call('flow-cancel',{id});return;}
    const text=$('prompt').value.trim(); if(!text)return;
    flowDraft.submitted=true; $('prompt').value='';
    const result=await call('flow-submit',{id,text});
    if(!result?.ok&&!$('prompt').value)$('prompt').value=text;
  },500);
}
function tab(which) {
  $('guideView').hidden=which!=='guide'; $('connectionView').hidden=which!=='connection';
  $('guideTab').classList.toggle('active',which==='guide'); $('connectionTab').classList.toggle('active',which==='connection');
}
async function call(action,payload) { try { return await window.brinky.call(action,payload); } catch { $('error').textContent='Brinky could not complete that action. Please try again.'; $('error').hidden=false; } }
function options(select,items,empty) {
  select.replaceChildren();
  if (!items.length) { const option=new Option(empty,''); select.add(option); }
  for(const item of items) select.add(new Option(item.name,item.id));
}
function render(state) {
  current=state;
  const connected=state.session.status==='connected';
  const sharing=state.session.sharing;
  const wispr=state.settings.inputProvider==='wispr';
  const thinking=state.phase==='thinking', listening=['starting-mic','listening'].includes(state.phase), holding=Boolean(state.flow), busy=thinking||listening||holding;
  $('status').classList.toggle('connected',sharing);
  $('status').replaceChildren(Object.assign(document.createElement('b'),{}),document.createTextNode(thinking?'Thinking with you':listening?'Listening':sharing?'Here to help':'Ready to meet you'));
  $('connectionDot').style.background=sharing?'#679577':'#c3c8bd';
  $('welcome').hidden=Boolean(state.answer)||busy;
  $('welcomeConnect').hidden=sharing;
  $('lesson').hidden=!state.answer||busy;
  if(state.answer) {
    $('answerTitle').textContent=state.answer.title; $('answerText').textContent=state.answer.instruction;
    $('lessonTag').textContent=state.demo?'POINTER PREVIEW':state.answer.done?'NICELY DONE':'ONE STEP AT A TIME';
    $('answerMeta').textContent=state.demo?'DEMO · NO SCREEN SHARED':'BRINKY SAYS';
    $('question').textContent=state.question; $('question').hidden=!state.question;
    $('next').disabled=state.demo||!sharing||busy;
    $('next').textContent=state.answer.done?'Ask something new':'Done, what’s next? →';
  }
  $('working').hidden=!busy;
  $('workingTitle').textContent=thinking?'Looking at your screen…':holding?(state.flow.phase==='recording'?'Listening with Wispr Flow…':state.flow.phase==='transcribing'?'Finishing your words…':'Starting Wispr Flow…'):state.phase==='starting-mic'?'Getting your microphone ready…':'I’m listening.';
  $('workingDetail').textContent=thinking?'Finding one clear next step. Keep your app in place.':holding?(state.flow.phase==='transcribing'?'Your question will send as soon as Flow inserts it.':'Keep M4 held while speaking. Release to send. Esc cancels.'):state.transcript||'Speak naturally. I’ll send after a pause.';
  $('mic').classList.toggle('listening',listening); $('micText').textContent=listening?'Finish speaking':wispr?'Dictate with Wispr Flow':'Speak to Brinky';
  $('mic').title=wispr?'Focus the question box, then use your Wispr Flow shortcut':'Speak to Brinky';
  $('mic').disabled=thinking||holding; $('send').disabled=busy; $('demo').disabled=busy; $('newLesson').disabled=busy;
  $('display').disabled=busy; $('model').disabled=busy; $('speak').checked=state.settings.speak;
  $('replyVoice').value=state.settings.speechProvider||'windows'; $('replyVoice').disabled=busy;
  $('voiceDescription').textContent=state.settings.speechProvider==='elevenlabs'?'George · Flash v2.5. Reply text is sent to ElevenLabs and uses your ElevenLabs credits. Recent repeats reuse the same audio.':'The original Windows voice. Free and runs on your PC.';
  $('voiceInput').value=state.settings.inputProvider||'windows'; $('voiceInput').disabled=busy;
  $('inputDescription').textContent=wispr?'Hold M4 (Ctrl + Shift + F8) to speak, then release to send. Wispr Flow receives that shortcut directly; Brinky opens the question box and sends the completed transcript. Your usual Ctrl + Space still works separately.':'Brinky records and transcribes with Windows speech recognition. Free and runs on your PC.';
  $('holdToTalk').checked=state.settings.holdToTalk; $('holdToTalk').disabled=busy||!wispr;
  $('dictationHint').textContent=state.holdShortcut?'Hold M4 (Ctrl + Shift + F8), speak after Flow’s ping, then release. Brinky sends automatically. Esc cancels.':'Use Ctrl + Space in this box, then press Enter to ask.';
  $('dictationHint').hidden=!wispr;
  $('privacyNote').textContent=wispr?'Wispr Flow handles dictation using your Flow settings. When you send a question, a screenshot of your selected screen is sent to ChatGPT.':'When you ask, a screenshot of this screen is sent to ChatGPT. Your microphone stays off until you speak.';
  $('shortcut').hidden=state.shortcut==='Shortcut unavailable';
  const displays=JSON.stringify(state.displays);
  if(displays!==lastDisplays){lastDisplays=displays;options($('display'),state.displays.map(d=>({id:d.id,name:d.name})),'No screen available');}
  $('display').value=state.settings.displayId;
  const models=JSON.stringify(state.models);
  if(models!==lastModels){lastModels=models;options($('model'),state.models.map(m=>({id:m.slug,name:m.displayName})),'Connect to load your models');}
  $('model').value=state.settings.model;
  $('connectionBadge').textContent=state.session.status==='connecting'?'Connecting…':sharing?'Connected':connected?'Plan usage off':'Not connected';
  $('accountName').textContent=state.session.identity?.email||state.session.identity?.name||'Connect securely in your browser.';
  $('planDescription').textContent=sharing?'Using ChatGPT plan. Your requests count toward your plan allowance.':connected?'Enable ChatGPT plan usage to get guidance.':'Eligible ChatGPT Plus and Pro plans. Usage counts toward your plan allowance.';
  $('connectLabel').textContent=connected&&!sharing?'Enable ChatGPT plan usage':'Continue with ChatGPT';
  $('connect').hidden=sharing||state.session.status==='connecting'; $('cancelLogin').hidden=state.session.status!=='connecting';
  $('accountActions').hidden=!connected; $('refreshModels').disabled=!sharing||busy;
  $('error').textContent=state.error; $('error').hidden=!state.error;
  syncFlow(state);
}
$('guideTab').onclick=()=>tab('guide'); $('connectionTab').onclick=()=>tab('connection');
$('welcomeConnect').onclick=()=>tab('connection');
$('connect').onclick=async()=>{const r=await call('connect');if(r?.ok&&current?.session.sharing)tab('guide');};
$('cancelLogin').onclick=()=>call('cancel-login'); $('disconnect').onclick=()=>call('disconnect'); $('usage').onclick=()=>call('usage');
$('refreshModels').onclick=()=>call('models');
$('model').onchange=e=>call('settings',{model:e.target.value}); $('display').onchange=e=>call('settings',{displayId:e.target.value}); $('speak').onchange=e=>call('settings',{speak:e.target.checked});
$('replyVoice').onchange=e=>call('settings',{speechProvider:e.target.value});
$('voiceInput').onchange=e=>call('settings',{inputProvider:e.target.value});
$('holdToTalk').onchange=e=>call('settings',{holdToTalk:e.target.checked});
async function send() {if(current?.flow||current?.phase==='thinking')return;const text=$('prompt').value.trim();if(!text)return;if(!current?.session.sharing){tab('connection');return;} $('prompt').value='';await call('ask',text);}
$('prompt').addEventListener('input',()=>{if(flowDraft){flowDraft.changed=true;scheduleFlowSend();}});
$('send').onclick=send; $('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
$('mic').onclick=()=>{if(!current?.session.sharing){tab('connection');return;}call('voice');};
$('stop').onclick=()=>call('stop'); $('demo').onclick=()=>call('demo'); $('repeat').onclick=()=>call('repeat');
$('next').onclick=()=>{if(current?.answer?.done){call('clear');$('prompt').focus();}else call('ask','I have done that. What is the next step?');};
$('newLesson').onclick=()=>call('clear'); $('minimize').onclick=()=>call('hide'); $('close').onclick=()=>call('quit');
document.addEventListener('keydown',e=>{if(e.key==='Escape')call('stop');});
window.brinky.onCompose(()=>{tab('guide');$('prompt').focus();});
window.brinky.onState(render); window.brinky.call('state').then(state=>{render(state);if(state.settings.inputProvider==='wispr')$('prompt').focus();});
