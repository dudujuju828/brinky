param([ValidateSet('listen','speak','play','narrate','probe','selftest')][string]$Mode = 'probe')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  if ($Mode -eq 'narrate') {
    $synth = $null
    try {
      [Console]::WriteLine('{"type":"narration-ready"}')
      [Console]::Out.Flush()
      while ($null -ne ($line = [Console]::In.ReadLine())) {
        $index = -1
        try {
          $payload = $line | ConvertFrom-Json
          $index = [int]$payload.index
          if ($index -lt 0 -or $index -gt 7) { throw 'Invalid tutorial section.' }
          if ($payload.audio) {
            $bytes = [Convert]::FromBase64String([string]$payload.audio)
            $stream = New-Object System.IO.MemoryStream(,$bytes)
            $player = New-Object System.Media.SoundPlayer($stream)
            try {
              $player.Load()
              [Console]::WriteLine('{"type":"segment-started","index":' + $index + '}'); [Console]::Out.Flush()
              $player.PlaySync()
            } finally { $player.Dispose(); $stream.Dispose() }
          } else {
            if ($null -eq $synth) {
              Add-Type -AssemblyName System.Speech
              $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
              $synth.Rate = 0
            }
            $text = [string]$payload.text
            if (-not $text.Trim() -or $text.Length -gt 1000) { throw 'Invalid tutorial text.' }
            [Console]::WriteLine('{"type":"segment-started","index":' + $index + '}'); [Console]::Out.Flush()
            $synth.Speak($text)
          }
          [Console]::WriteLine('{"type":"segment-finished","index":' + $index + '}'); [Console]::Out.Flush()
        } catch {
          [Console]::WriteLine('{"type":"segment-error","index":' + $index + '}'); [Console]::Out.Flush()
        }
      }
    } finally { if ($null -ne $synth) { $synth.Dispose() } }
    exit 0
  }
  if ($Mode -eq 'play') {
    $payload = [Console]::In.ReadLine() | ConvertFrom-Json
    $bytes = [Convert]::FromBase64String([string]$payload.audio)
    $stream = New-Object System.IO.MemoryStream(,$bytes)
    $player = New-Object System.Media.SoundPlayer($stream)
    try { $player.Load(); $player.PlaySync() }
    finally { $player.Dispose(); $stream.Dispose() }
    exit 0
  }
  Add-Type -AssemblyName System.Speech
  if ($Mode -eq 'probe') {
    $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name })
    @{ type = 'probe'; recognizers = $recognizers } | ConvertTo-Json -Compress
    exit 0
  }
  if ($Mode -eq 'speak') {
    $payload = [Console]::In.ReadLine() | ConvertFrom-Json
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.Rate = 0
    $synth.Speak([string]$payload.text)
    $synth.Dispose()
    exit 0
  }
  $code = @'
using System;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
public static class BrinkySpeech {
  static readonly object gate = new object();
  static void Emit(object value) { lock (gate) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); Console.Out.Flush(); } }
  public static void Run(bool test) {
    var available = SpeechRecognitionEngine.InstalledRecognizers();
    if (available.Count == 0) throw new Exception("Install a Windows speech language under Settings > Time & language > Speech, or type your question.");
    var chosen = available[0];
    foreach (var info in available) if (info.Culture.Name == "en-US") chosen = info;
    using (var engine = new SpeechRecognitionEngine(chosen)) {
      engine.LoadGrammar(new DictationGrammar());
      engine.InitialSilenceTimeout = TimeSpan.FromSeconds(15);
      engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(1000);
      engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(1600);
      if (test) {
        using (var audio = new System.IO.MemoryStream()) {
          using (var synth = new SpeechSynthesizer()) { synth.SetOutputToWaveStream(audio); synth.Speak("Show me where to click."); }
          audio.Position = 0;
          engine.SetInputToWaveStream(audio);
          var result = engine.Recognize();
          Emit(new { type = "done", text = result == null ? "" : result.Text });
        }
        return;
      }
      engine.SetInputToDefaultAudioDevice();
      using (var done = new ManualResetEvent(false)) {
        string final = "";
        engine.SpeechHypothesized += (s, e) => Emit(new { type = "partial", text = e.Result.Text });
        engine.SpeechRecognized += (s, e) => { final = e.Result.Text; };
        engine.RecognizeCompleted += (s, e) => { done.Set(); };
        engine.RecognizeAsync(RecognizeMode.Single);
        Emit(new { type = "ready", language = chosen.Culture.Name });
        Task.Run(() => { Console.In.ReadLine(); try { engine.RecognizeAsyncStop(); } catch {} });
        if (!done.WaitOne(30000)) { engine.RecognizeAsyncCancel(); done.WaitOne(1500); }
        Emit(new { type = "done", text = final });
      }
    }
  }
}
'@
  Add-Type -TypeDefinition $code -ReferencedAssemblies System.Speech,System.Web.Extensions
  [BrinkySpeech]::Run($Mode -eq 'selftest')
} catch {
  @{ type = 'error'; message = 'Windows speech is unavailable. Check microphone access and your installed speech language, or type your question.' } | ConvertTo-Json -Compress
  exit 1
}
