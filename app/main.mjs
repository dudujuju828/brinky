import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, shell, Tray } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createChatGPT, ChatGPTError, CHATGPT_USAGE_URL } from './chatgpt-runtime.mjs';
import { guidanceSchema, instructions, makeInput, parseGuidance, targetToRect } from './guidance.mjs';
import { Voice } from './voice.mjs';
import { FlowHold } from './flow-hold.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testMode = process.env.BRINKY_TEST_MODE === '1';
app.setName('Brinky');
app.setPath('userData', process.env.BRINKY_DATA_DIR || join(app.getPath('appData'), 'Brinky'));
const dataDir = app.getPath('userData');
let panel, orb, overlay, tray, chatgpt, activeRequest, pointerTimer, quitting = false;
let pointer, history = [], lastDisplay, accountBusy = false;
let flowTimer;
let state = {
  session: { status: 'disconnected', sharing: false }, models: [],
  settings: { model: '', displayId: '', speak: true, speechProvider: 'windows', inputProvider: 'windows', holdToTalk: true }, displays: [],
  phase: 'idle', transcript: '', answer: null, question: '', error: '',
  shortcut: 'Ctrl + Alt + B', captureTime: null, demo: false,
  flow: null, holdShortcut: false,
};
const voice = new Voice(event => {
  if (event.type === 'playback-error') { state.error = event.message; publish(); return; }
  if (state.phase !== 'listening' && state.phase !== 'starting-mic') return;
  if (event.type === 'ready') state.phase = 'listening';
  if (event.type === 'partial') state.transcript = event.text;
  if (event.type === 'error') { state.phase = 'idle'; state.error = event.message; }
  if (event.type === 'done') {
    state.phase = 'idle'; state.transcript = '';
    if (event.text?.trim()) void ask(event.text).catch(reportError);
    else state.error = 'I didn’t catch that. Try speaking again, or type your question.';
  }
  publish();
}, {
  getProvider: () => state.settings.speechProvider,
  getElevenLabsKey: async () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage unavailable.');
    return safeStorage.decryptString(await readFile(join(dataDir, 'elevenlabs-key.bin')));
  },
});
const flowHold = new FlowHold(event => {
  if (event.type === 'ready') {
    state.holdShortcut = state.settings.inputProvider === 'wispr' && state.settings.holdToTalk;
    flowHold.send('enable', state.holdShortcut ? 1 : 0); publish(); return;
  }
  if (event.type === 'pressed') {
    try { startFlowHold(event.id); } catch (error) { flowHold.send('cancel', event.id); reportError(error); }
    return;
  }
  if (event.type === 'unavailable') {
    state.holdShortcut = false;
    if (state.flow) { endFlow(); state.error = 'The hold-to-talk helper stopped. Use Ctrl + Space in the question box, then press Enter.'; }
    publish();
    return;
  }
  if (!state.flow || state.flow.id !== event.id) return;
  if (event.type === 'recording') state.flow.phase = 'recording';
  else if (event.type === 'released') {
    state.flow.phase = 'transcribing'; clearTimeout(flowTimer);
    flowTimer = setTimeout(() => { endFlow(); state.error = 'Flow did not insert a transcript. Check that Wispr Flow is ready and has Ctrl + Shift + F8 under Push to talk.'; publish(); }, 30000);
  } else {
    endFlow();
    if (event.type === 'error') state.error = 'Could not observe the voice shortcut. Use Ctrl + Space in the question box, then press Enter.';
  }
  publish();
});

function endFlow(cancel = true) {
  const previous = state.flow; state.flow = null; clearTimeout(flowTimer);
  if (previous) flowHold.send(cancel ? 'cancel' : 'complete', previous.id);
}
function startFlowHold(id) {
  if (state.settings.inputProvider !== 'wispr' || !state.settings.holdToTalk || state.flow || accountBusy) { flowHold.send('cancel', id); return; }
  if (!state.session.sharing) { showPanel(); throw new Error('Connect your ChatGPT account first.'); }
  if (!flowHold.ready) { flowHold.start(); throw new Error('The voice shortcut is getting ready. Try holding M4 again in a moment.'); }
  activeRequest?.abort(); activeRequest = undefined;
  voice.cancel(); clearPointer(); state.error = ''; state.phase = 'idle';
  state.flow = { id, phase: 'arming' };
  flowTimer = setTimeout(() => { endFlow(); publish(); }, 150000);
  showPanel(); publish();
}
function configureFlowHold() {
  endFlow(); globalShortcut.unregister('F8'); state.holdShortcut = false;
  if (state.settings.inputProvider === 'wispr' && state.settings.holdToTalk) {
    flowHold.start();
    state.holdShortcut = flowHold.ready;
    if (flowHold.ready) flowHold.send('enable', 1);
  } else flowHold.send('enable', 0);
}

function publish() {
  for (const window of [panel, orb]) if (window && !window.isDestroyed()) window.webContents.send('brinky:state', state);
}
function reportError(error) {
  state.error = error instanceof ChatGPTError ? error.message : error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  publish();
}
function showPanel() { panel?.show(); panel?.focus(); }
function clearPointer() {
  clearTimeout(pointerTimer); pointer = undefined;
  if (overlay && !overlay.isDestroyed()) overlay.hide();
}
function stop() {
  endFlow();
  activeRequest?.abort(); voice.cancel(); clearPointer();
  state.phase = 'idle'; state.transcript = ''; publish();
}
function getDisplay() {
  const display = screen.getAllDisplays().find(d => String(d.id) === state.settings.displayId);
  if (!display) throw new Error('Choose an available screen in Brinky first.');
  return display;
}
function updateDisplays() {
  state.displays = screen.getAllDisplays().map((d,i) => ({ id: String(d.id), name: d.label || `Screen ${i+1}`, width: d.bounds.width, height: d.bounds.height }));
  if (!state.displays.some(d => d.id === state.settings.displayId)) state.settings.displayId = String(screen.getPrimaryDisplay().id);
  clearPointer(); publish();
}
async function saveSettings() { await writeFile(join(dataDir, 'preferences.json'), JSON.stringify(state.settings, null, 2)); }
async function refreshModels() {
  if (!state.session.sharing) { state.models = []; return; }
  state.models = await chatgpt.listModels();
  if (!state.models.some(m => m.slug === state.settings.model)) state.settings.model = state.models[0]?.slug || '';
  publish(); await saveSettings();
}
async function changeAccount(action) {
  if (accountBusy) throw new Error('Finish or cancel the current sign-in first.');
  accountBusy = true; stop(); history = []; state.models = []; state.answer = null; state.error = ''; publish();
  try { await action(); state.session = await chatgpt.getSession(); await refreshModels(); }
  finally { accountBusy = false; state.session = await chatgpt.getSession(); publish(); }
}
async function capture(display, signal) {
  const visible = [panel, orb].filter(w => w?.isVisible());
  visible.forEach(w => w.hide()); clearPointer();
  try {
    await new Promise(resolve => setTimeout(resolve, 260));
    signal.throwIfAborted();
    const physicalWidth = display.size.width * display.scaleFactor;
    const physicalHeight = display.size.height * display.scaleFactor;
    const scale = Math.min(1, 1920 / physicalWidth, 1440 / physicalHeight);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(physicalWidth * scale), height: Math.round(physicalHeight * scale) } });
    const source = sources.find(s => s.display_id === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error('Could not capture that screen. Choose another screen and try again.');
    return `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString('base64')}`;
  } finally { visible.forEach(w => { if (!w.isDestroyed()) w.showInactive(); }); }
}
async function showPointer(target, display, demo = false) {
  clearPointer();
  if (!target || !overlay || overlay.isDestroyed()) return;
  const current = screen.getAllDisplays().find(d => d.id === display.id);
  if (!current || JSON.stringify(current.bounds) !== JSON.stringify(display.bounds)) return;
  overlay.setBounds(display.bounds);
  pointer = { ...targetToRect(target, display.bounds), demo };
  overlay.webContents.send('brinky:pointer', pointer);
  overlay.showInactive();
  pointerTimer = setTimeout(clearPointer, 18000);
}
async function ask(rawQuestion) {
  if (activeRequest || accountBusy) throw new Error('Wait for this step, or press Stop first.');
  const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : '';
  if (!question || question.length > 4000) throw new Error('Ask a question under 4,000 characters.');
  if (!state.session.sharing) { showPanel(); throw new Error('Connect ChatGPT and enable plan usage in the Connection tab first.'); }
  if (!state.models.some(m => m.slug === state.settings.model)) throw new Error('Load and choose a model in Connection first.');
  const display = getDisplay();
  endFlow();
  voice.cancel(); clearPointer();
  const controller = new AbortController(); activeRequest = controller;
  state.phase = 'thinking'; state.error = ''; state.question = question; state.demo = false; state.transcript = ''; publish();
  try {
    const screenshot = testMode ? 'data:image/jpeg;base64,/9j/2Q==' : await capture(display, controller.signal);
    state.captureTime = Date.now(); publish();
    const result = await chatgpt.streamResponse({ model: state.settings.model, instructions,
      input: makeInput(history, question, screenshot),
      textFormat: { type: 'json_schema', name: 'brinky_step', strict: true, schema: guidanceSchema },
      signal: controller.signal,
    });
    controller.signal.throwIfAborted();
    const answer = parseGuidance(result.text);
    history = [...history, { role: 'user', content: question }, { role: 'assistant', content: JSON.stringify(answer) }].slice(-10);
    state.answer = answer; state.phase = 'ready'; lastDisplay = display;
    await showPointer(answer.target, display);
    if (state.settings.speak && !testMode) voice.speak(answer.instruction);
    publish();
  } catch (error) {
    if (!controller.signal.aborted) { state.phase = 'idle'; reportError(error); }
  } finally { if (activeRequest === controller) activeRequest = undefined; publish(); }
}
function toggleVoice() {
  endFlow();
  if (state.phase === 'listening' || state.phase === 'starting-mic') { voice.finish(); return; }
  if (!state.session.sharing) { showPanel(); throw new Error('Connect your ChatGPT account first.'); }
  if (activeRequest || accountBusy) throw new Error('Wait for the current step, or press Stop.');
  if (state.settings.inputProvider === 'wispr') {
    voice.cancel(); clearPointer(); state.error = ''; state.transcript = ''; state.phase = 'idle';
    showPanel(); publish(); panel.webContents.send('brinky:compose');
    return;
  }
  clearPointer(); state.error = ''; state.transcript = ''; state.phase = 'starting-mic'; publish();
  voice.listen();
}
async function demo() {
  stop(); state.demo = true;
  state.answer = { title: 'That’s the spot.', instruction: 'This is a pointer preview. In a lesson, I’ll put this ring around the control you need, then wait for you to click it.', target: { x: .46, y: .43, width: .08, height: .09, label: 'Click here' }, done: false };
  state.phase = 'ready'; state.question = ''; lastDisplay = getDisplay(); publish();
  await showPointer(state.answer.target, lastDisplay, true);
}
function secureWindow(options) {
  const window = new BrowserWindow({ ...options, webPreferences: { preload: join(root,'app/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: testMode } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  return window;
}
async function createWindows() {
  const area = screen.getPrimaryDisplay().workArea;
  panel = secureWindow({ width: 460, height: Math.min(820,area.height-40), minWidth: 420, minHeight: 640, x: area.x+area.width-480, y: area.y+20, frame: false, show: false, title: 'Brinky', backgroundColor: '#f8f7f2' });
  panel.on('close', event => { if (!quitting) { event.preventDefault(); panel.hide(); } });
  panel.on('blur', () => { if (state.flow) { endFlow(); publish(); } });
  orb = secureWindow({ width: 230, height: 70, x: area.x+area.width-250, y: area.y+area.height-90, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, title: 'Brinky companion' });
  overlay = secureWindow({ ...screen.getPrimaryDisplay().bounds, frame: false, transparent: true, resizable: false, movable: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, show: false, title: 'Brinky pointer', hasShadow: false });
  overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.setIgnoreMouseEvents(true);
  await Promise.all([panel.loadFile(join(root,'renderer/index.html')), orb.loadFile(join(root,'renderer/orb.html')), overlay.loadFile(join(root,'renderer/overlay.html'))]);
  panel.show(); orb.showInactive();
  const icon = nativeImage.createFromPath(join(root,'renderer/brinky.png'));
  tray = new Tray(icon.isEmpty() ? await app.getFileIcon(process.execPath) : icon.resize({width:16,height:16}));
  tray.setToolTip('Brinky — Ctrl + Alt + B to talk');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Brinky', click: showPanel },
    { label: 'Talk to Brinky', click: () => { try { toggleVoice(); } catch(e) { reportError(e); } } },
    { label: 'Stop & clear pointer', click: stop },
    { type: 'separator' }, { label: 'Quit Brinky', click: () => app.quit() },
  ]));
  tray.on('click', showPanel);
}
function installIPC() {
  ipcMain.handle('brinky:action', async(event, action, payload) => {
    if (![panel,orb].some(w => w && event.sender === w.webContents && event.senderFrame === w.webContents.mainFrame && event.senderFrame.url.startsWith(pathToFileURL(join(root,'renderer')).href + '/'))) throw new Error('Invalid Brinky sender.');
    try {
      switch (action) {
        case 'state': return state;
        case 'show': showPanel(); break;
        case 'hide': panel.hide(); break;
        case 'quit': app.quit(); break;
        case 'connect': await changeAccount(() => chatgpt.signIn(state.session.status === 'connected' && !state.session.sharing ? { reconsent: true } : {})); break;
        case 'cancel-login': chatgpt.cancelSignIn(); break;
        case 'disconnect': await changeAccount(() => chatgpt.disconnect()); break;
        case 'models': await refreshModels(); break;
        case 'usage': await shell.openExternal(CHATGPT_USAGE_URL); break;
        case 'settings': {
          if (!payload || typeof payload !== 'object') throw new Error('Invalid settings.');
          if (activeRequest || accountBusy) throw new Error('Finish or stop the current request first.');
          if (payload.model !== undefined) { if (!state.models.some(m => m.slug === payload.model)) throw new Error('Choose an available model.'); state.settings.model = payload.model; }
          if (payload.displayId !== undefined) { if (!state.displays.some(d => d.id === payload.displayId)) throw new Error('Choose an available screen.'); state.settings.displayId = payload.displayId; clearPointer(); }
          if (typeof payload.speak === 'boolean') { state.settings.speak = payload.speak; if (!payload.speak) voice.stopSpeaking(); }
          if (payload.speechProvider !== undefined) {
            if (!['windows', 'elevenlabs'].includes(payload.speechProvider)) throw new Error('Choose an available reply voice.');
            voice.stopSpeaking(); state.settings.speechProvider = payload.speechProvider;
          }
          if (payload.inputProvider !== undefined) {
            if (!['windows', 'wispr'].includes(payload.inputProvider)) throw new Error('Choose an available voice input.');
            voice.cancel(); state.phase = 'idle'; state.transcript = ''; state.settings.inputProvider = payload.inputProvider;
          }
          if (typeof payload.holdToTalk === 'boolean') state.settings.holdToTalk = payload.holdToTalk;
          if (payload.inputProvider !== undefined || typeof payload.holdToTalk === 'boolean') configureFlowHold();
          await saveSettings(); break;
        }
        case 'ask': await ask(payload); break;
        case 'voice': toggleVoice(); break;
        case 'flow-ready': {
          if (event.sender !== panel.webContents || !state.flow || state.flow.id !== payload?.id || state.flow.phase !== 'arming') break;
          if (!payload.empty || !payload.focused) { endFlow(); state.error = 'Send or clear the question box first, then hold M4.'; break; }
          state.flow.phase = 'starting'; flowHold.send('begin', state.flow.id); break;
        }
        case 'flow-submit': {
          if (event.sender !== panel.webContents || !state.flow || state.flow.id !== payload?.id || state.flow.phase !== 'transcribing') return { ok: false };
          if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 4000) { endFlow(); throw new Error('Ask a question under 4,000 characters.'); }
          endFlow(false); await ask(payload.text); break;
        }
        case 'flow-cancel': if (state.flow?.id === payload?.id) endFlow(); break;
        case 'stop': stop(); break;
        case 'repeat': if (state.answer) { if (state.settings.speak && !testMode) voice.speak(state.answer.instruction); if (state.demo || (state.captureTime && Date.now()-state.captureTime < 30000)) await showPointer(state.answer.target,lastDisplay,state.demo); } break;
        case 'demo': if (accountBusy || activeRequest) throw new Error('Stop the current request first.'); await demo(); break;
        case 'clear': stop(); history=[]; state.answer=null; state.question=''; state.error=''; state.demo=false; state.captureTime=null; break;
        default: throw new Error('Unknown Brinky action.');
      }
      publish(); return { ok: true };
    } catch(error) { reportError(error); return { ok: false, error: state.error }; }
  });
}
function fakeClient() {
  let session = { status:'disconnected', sharing:false }; const listeners=[];
  const announce = () => listeners.forEach(fn => fn(session));
  return {
    getSession: async()=>session, subscribe: fn=>listeners.push(fn),
    signIn: async()=>{ session={status:'connected',sharing:true,identity:{name:'Test connection'}}; announce(); return session; },
    disconnect: async()=>{ session={status:'disconnected',sharing:false}; announce(); }, cancelSignIn() {},
    listModels: async()=>[{slug:'test-model',displayName:'Test model (offline)'}],
    streamResponse: async({signal})=>{
      await new Promise(resolve=>setTimeout(resolve,250)); signal.throwIfAborted();
      return {text:JSON.stringify({title:'Open the menu',instruction:'Click the highlighted menu, then tell me when you are ready.',target:{x:.1,y:.1,width:.04,height:.03,label:'Menu'},done:false})};
    },
  };
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showPanel);
  app.whenReady().then(async()=>{
    await mkdir(dataDir,{recursive:true});
    try { const saved=JSON.parse(await readFile(join(dataDir,'preferences.json'),'utf8')); for(const key of ['model','displayId']) if(typeof saved[key]==='string') state.settings[key]=saved[key]; if(typeof saved.speak==='boolean') state.settings.speak=saved.speak; if(['windows','elevenlabs'].includes(saved.speechProvider)) state.settings.speechProvider=saved.speechProvider; if(['windows','wispr'].includes(saved.inputProvider)) state.settings.inputProvider=saved.inputProvider; if(typeof saved.holdToTalk==='boolean') state.settings.holdToTalk=saved.holdToTalk; } catch {}
    chatgpt = testMode ? fakeClient() : createChatGPT({
      appName:'Brinky', appId:'brinky', redirectPort:0, sendHostId:true,
      storageDir:join(dataDir,'chatgpt'),
      credentialEncryption:{ id:'electron-safe-storage-v1', isAvailable:()=>safeStorage.isEncryptionAvailable(), encrypt:text=>safeStorage.encryptString(text), decrypt:data=>safeStorage.decryptString(Buffer.from(data)) },
      openBrowser:async url=>{ if(new URL(url).origin!=='https://auth.openai.com') throw new Error('Unexpected sign-in address.'); await shell.openExternal(url); },
    });
    state.session=await chatgpt.getSession();
    chatgpt.subscribe(session=>{state.session=session;publish();});
    updateDisplays(); installIPC(); await createWindows();
    if (!globalShortcut.register('CommandOrControl+Alt+B',()=>{try{toggleVoice();}catch(e){reportError(e);}})) {state.shortcut='Shortcut unavailable'; state.error='Ctrl + Alt + B is in use. You can use the microphone button.';}
    globalShortcut.register('CommandOrControl+Alt+Escape',stop);
    configureFlowHold();
    screen.on('display-added',updateDisplays); screen.on('display-removed',updateDisplays); screen.on('display-metrics-changed',updateDisplays);
    await refreshModels().catch(reportError); publish();
  }).catch(error=>{ console.error('Brinky startup failed:',error.message); app.quit(); });
}
app.on('window-all-closed',()=>{});
app.on('before-quit',()=>{quitting=true;stop();flowHold.close();chatgpt?.cancelSignIn();globalShortcut.unregisterAll();tray?.destroy();});
