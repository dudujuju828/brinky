param([uint32]$OwnerProcessId = 0, [long]$SequenceBase = 0, [switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$code = @'
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class BrinkyFlowHold {
  [StructLayout(LayoutKind.Sequential)] struct DEVICE { public ushort page, usage; public uint flags; public IntPtr target; }
  [StructLayout(LayoutKind.Sequential)] struct HEADER { public uint type, size; public IntPtr device, param; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBOARD { public ushort scan, flags, reserved, key; public uint message, extra; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
  [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterRawInputDevices(DEVICE[] devices, uint count, uint size);
  [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint process);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  static readonly bool[] keys = new bool[256];
  static readonly ConcurrentQueue<string> commands = new ConcurrentQueue<string>();
  static readonly uint headerSize = (uint)Marshal.SizeOf(typeof(HEADER));
  static readonly Stopwatch clock = Stopwatch.StartNew();
  static uint owner;
  static IntPtr target;
  static bool enabled, physicalHeld, pending, armed, released;
  static long id, sequence, began, heartbeat;
  static void Emit(string type, long token) { Console.WriteLine("{\"type\":\""+type+"\",\"id\":"+token+"}"); Console.Out.Flush(); }
  static bool Chord() { return keys[0x77] && !keys[0xA2] && !keys[0xA3] && !keys[0xA0] && !keys[0xA1] && !keys[0xA4] && !keys[0xA5]; }
  static void Clear() { pending=false; armed=false; released=false; }
  static void Cancel() { if (pending) { Clear(); Emit("cancelled",id); } }
  static bool IsTarget(IntPtr window) { uint pid; return window!=IntPtr.Zero && IsWindow(window) && GetWindowThreadProcessId(window,out pid)!=0 && pid==owner; }
  static void FocusTarget() {
    if (!IsTarget(target)) return;
    // Electron may already have completed activation after the press event.
    if (GetForegroundWindow()==target && !IsIconic(target)) return;
    // Called in response to a physical talk-key press, never by synthesizing keys.
    AllowSetForegroundWindow(owner);
    ShowWindowAsync(target,IsIconic(target)?9:5);
    SetForegroundWindow(target);
    if (GetForegroundWindow()==target) return;
    // An existing editor can retain the foreground input queue. Join it only
    // for this explicit talk-key activation, and always detach immediately.
    uint ignored;
    uint current=GetCurrentThreadId();
    uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out ignored);
    uint destination=GetWindowThreadProcessId(target,out ignored);
    bool joinedForeground=false, joinedDestination=false;
    try {
      if (foreground!=0 && foreground!=current) joinedForeground=AttachThreadInput(current,foreground,true);
      if (destination!=0 && destination!=current && destination!=foreground) joinedDestination=AttachThreadInput(current,destination,true);
      BringWindowToTop(target); SetForegroundWindow(target);
      if (GetForegroundWindow()==target && (joinedDestination || destination==current || destination==foreground && joinedForeground)) SetFocus(target);
    } finally {
      if (joinedDestination) AttachThreadInput(current,destination,false);
      if (joinedForeground) AttachThreadInput(current,foreground,false);
    }
  }
  static void ResetKeys() {
    Array.Clear(keys,0,keys.Length);
    foreach (int key in new[]{0xA2,0xA3,0xA0,0xA1,0xA4,0xA5,0x77}) keys[key]=(GetAsyncKeyState(key)&0x8000)!=0;
    physicalHeld=Chord();
  }
  static void ReleaseIfReady() { if (pending && !physicalHeld && !released) { released=true; Emit("released",id); } }
  static void Press() {
    if (!enabled || physicalHeld) return;
    Cancel(); id=++sequence; pending=true; armed=false; released=false; began=clock.ElapsedMilliseconds;
    // Let Electron open and prepare the composer while native activation runs.
    // Window activation must not delay delivery of the physical key press.
    physicalHeld=true; Emit("pressed",id); FocusTarget();
  }
  static void Key(KEYBOARD input) {
    if (input.key>=255 || input.scan==0xFF) return;
    int key=input.key;
    if (key==0x10) key=input.scan==0x36?0xA1:0xA0;
    else if (key==0x11) key=(input.flags&2)!=0?0xA3:0xA2;
    else if (key==0x12) key=(input.flags&2)!=0?0xA5:0xA4;
    // Discard unrelated keys. No typing or transcript is recorded by this helper.
    if (key!=0x77 && key!=0x1B && key!=9 && key!=0x5B && key!=0x5C && (key<0xA0 || key>0xA5)) return;
    bool down=(input.flags&1)==0;
    keys[key]=down;
    if (down && (key==0x1B || key==0x5B || key==0x5C || (key==9 && (keys[0xA4] || keys[0xA5])))) Cancel();
    bool chord=Chord();
    if (chord && !physicalHeld && enabled) {
      // A new physical press always supersedes a stale transcription session.
      Press();
    }
    physicalHeld=chord;
    ReleaseIfReady();
  }
  static void Mouse(IntPtr data) {
    if (!pending || !IsTarget(target)) return;
    ushort buttons=(ushort)Marshal.ReadInt16(data,4);
    if ((buttons&0x155)==0) return; // Button-down events only, never pointer movement.
    POINT point; if (!GetCursorPos(out point)) return;
    IntPtr clicked=GetAncestor(WindowFromPoint(point),2);
    if (clicked==IntPtr.Zero || IsTarget(clicked)) return;
    uint pid; GetWindowThreadProcessId(clicked,out pid);
    try { using (var process=Process.GetProcessById((int)pid)) { if (process.ProcessName.StartsWith("Wispr",StringComparison.OrdinalIgnoreCase)) return; } } catch {}
    Cancel(); // A deliberate click into another app wins over focus recovery.
  }
  sealed class InputWindow : NativeWindow, IDisposable {
    public InputWindow() { CreateHandle(new CreateParams { Caption="Brinky input observer", Parent=new IntPtr(-3) }); }
    protected override void WndProc(ref Message message) {
      if (message.Msg==0xFF) {
        uint size=0;
        if (GetRawInputData(message.LParam,0x10000003,IntPtr.Zero,ref size,headerSize)==0 && size>=headerSize && size<65536) {
          IntPtr data=Marshal.AllocHGlobal((int)size);
          try {
            if (GetRawInputData(message.LParam,0x10000003,data,ref size,headerSize)==size) {
              var header=(HEADER)Marshal.PtrToStructure(data,typeof(HEADER));
              IntPtr payload=IntPtr.Add(data,(int)headerSize);
              if (header.type==1 && size>=headerSize+16) Key((KEYBOARD)Marshal.PtrToStructure(payload,typeof(KEYBOARD)));
              else if (header.type==0 && size>=headerSize+24) Mouse(payload);
            }
          } finally { Marshal.FreeHGlobal(data); }
        }
      } else if (message.Msg==0xFE) { Cancel(); ResetKeys(); }
      base.WndProc(ref message);
    }
    public void Dispose() { DestroyHandle(); }
  }
  public static void Run(uint ownerPid, long firstSequence) {
    owner=ownerPid; sequence=firstSequence; ResetKeys();
    using (var window=new InputWindow()) {
      var devices=new[]{new DEVICE {page=1,usage=6,flags=0x2100,target=window.Handle},new DEVICE {page=1,usage=2,flags=0x2100,target=window.Handle}};
      if (!RegisterRawInputDevices(devices,(uint)devices.Length,(uint)Marshal.SizeOf(typeof(DEVICE)))) throw new Exception("Keyboard registration failed.");
      var reader=new Thread(()=>{try {string line;while((line=Console.ReadLine())!=null)commands.Enqueue(line);}finally{commands.Enqueue("quit:0");}});
      reader.IsBackground=true; reader.Start();
      using (var timer=new System.Windows.Forms.Timer()) {
        timer.Interval=20;
        timer.Tick+=(sender,args)=>{
          string command;
          while(commands.TryDequeue(out command)) {
            var parts=command.Split(':'); long token;
            if(parts.Length!=2 || !Int64.TryParse(parts[1],out token))continue;
            if(parts[0]=="quit"){Application.ExitThread();return;}
            if(parts[0]=="target"){var candidate=new IntPtr(token);if(IsTarget(candidate))target=candidate;continue;}
            if(parts[0]=="enable"){enabled=token==1;if(!enabled)Clear();continue;}
            if(parts[0]=="reset"){Cancel();ResetKeys();continue;}
            if(parts[0]=="press"){
              if((GetAsyncKeyState(0x77)&0x8000)!=0){keys[0x77]=true;Press();}
              continue;
            }
            if(token!=id)continue;
            if(parts[0]=="focus" && pending)FocusTarget();
            else if(parts[0]=="begin" && pending && !armed){armed=true;ReleaseIfReady();}
            else if(parts[0]=="cancel" || parts[0]=="complete")Clear();
          }
          if(pending && clock.ElapsedMilliseconds-began>180000)Cancel();
          if(physicalHeld && (GetAsyncKeyState(0x77)&0x8000)==0){keys[0x77]=false;physicalHeld=false;ReleaseIfReady();}
          if(clock.ElapsedMilliseconds-heartbeat>=1000){heartbeat=clock.ElapsedMilliseconds;Emit("alive",0);}
        };
        try {timer.Start();Emit("ready",0);Application.Run();}
        finally {
          foreach (var device in devices) RegisterRawInputDevices(new[]{new DEVICE {page=device.page,usage=device.usage,flags=1,target=IntPtr.Zero}},1,(uint)Marshal.SizeOf(typeof(DEVICE)));
        }
      }
    }
  }
}
'@
try {
  Add-Type -TypeDefinition $code -ReferencedAssemblies System.dll,System.Core.dll,System.Windows.Forms.dll
  if ($CompileOnly) { Write-Output 'Brinky input helper compiled.' }
  else { [BrinkyFlowHold]::Run($OwnerProcessId, $SequenceBase) }
} catch {
  if ($CompileOnly) { throw }
  [Console]::WriteLine('{"type":"unavailable","id":0}')
  exit 1
}
