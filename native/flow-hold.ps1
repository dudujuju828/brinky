$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$code = @'
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class BrinkyFlowHold {
  delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct KEYEVENT { public uint vkCode, scanCode, flags, time; public UIntPtr extra; }
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type, HookProc callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  static readonly bool[] keys = new bool[256];
  static readonly ConcurrentQueue<string> commands = new ConcurrentQueue<string>();
  static HookProc callback = Observe;
  static IntPtr hook;
  static bool enabled, physicalHeld, pending, armed, released;
  static int id, sequence;
  static DateTime began;
  static void Emit(string type, int token) { Console.WriteLine("{\"type\":\""+type+"\",\"id\":"+token+"}"); Console.Out.Flush(); }
  static bool Chord() { return keys[0x77] && (keys[0x11] || keys[0xA2] || keys[0xA3]) && (keys[0x10] || keys[0xA0] || keys[0xA1]); }
  static void Clear() { pending=false; armed=false; released=false; }
  static void ReleaseIfReady() { if (pending && armed && !physicalHeld && !released) { released=true; Emit("released",id); } }
  static IntPtr Observe(int code, IntPtr message, IntPtr data) {
    try {
      if (code >= 0) {
        var e=(KEYEVENT)Marshal.PtrToStructure(data,typeof(KEYEVENT));
        int msg=message.ToInt32(); bool down=msg==0x100 || msg==0x104;
        if (e.vkCode < 256 && (e.flags & 0x10)==0 && (down || msg==0x101 || msg==0x105)) {
          keys[e.vkCode]=down;
          bool chord=Chord();
          if (chord && !physicalHeld && enabled && !pending) {
            id=++sequence; pending=true; armed=false; released=false; began=DateTime.UtcNow;
            Emit("pressed",id);
          }
          physicalHeld=chord;
          if (down && e.vkCode==0x1B && pending) { Clear(); Emit("cancelled",id); }
          ReleaseIfReady();
        }
      }
    } catch { Clear(); }
    // Observe only: Flow receives the original hardware events, including release.
    return CallNextHookEx(hook,code,message,data);
  }
  public static void Run() {
    foreach (int key in new[]{0xA2,0xA3,0xA0,0xA1,0x77}) keys[key]=(GetAsyncKeyState(key)&0x8000)!=0;
    physicalHeld=Chord();
    hook=SetWindowsHookEx(13,callback,GetModuleHandle(null),0);
    if (hook==IntPtr.Zero) throw new Exception();
    var reader=new Thread(()=>{try {string line;while((line=Console.ReadLine())!=null)commands.Enqueue(line);}finally{commands.Enqueue("quit:0");}});
    reader.IsBackground=true;reader.Start();
    var timer=new System.Windows.Forms.Timer();timer.Interval=15;
    timer.Tick+=(sender,args)=>{
      string command;
      while(commands.TryDequeue(out command)) {
        var parts=command.Split(':');int token;
        if(parts.Length!=2 || !Int32.TryParse(parts[1],out token))continue;
        if(parts[0]=="quit"){Application.ExitThread();return;}
        if(parts[0]=="enable"){enabled=token==1;if(!enabled)Clear();continue;}
        if(token!=id)continue;
        if(parts[0]=="begin" && pending && !armed){armed=true;Emit("recording",id);ReleaseIfReady();}
        else if(parts[0]=="cancel" || parts[0]=="complete")Clear();
      }
      if(pending && (DateTime.UtcNow-began).TotalSeconds>180){Clear();Emit("cancelled",id);}
    };
    try {timer.Start();Emit("ready",0);Application.Run();}
    finally {timer.Dispose();UnhookWindowsHookEx(hook);}
  }
}
'@
try { Add-Type -TypeDefinition $code -ReferencedAssemblies System.dll,System.Core.dll,System.Windows.Forms.dll; [BrinkyFlowHold]::Run() }
catch { [Console]::WriteLine('{"type":"unavailable","id":0}') }
