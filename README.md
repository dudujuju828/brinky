# Brinky

<img src="renderer/brinky.png" alt="Brinky mascot" width="100">

A Windows desktop companion that helps you learn apps such as Blender. Ask a question, hear one instruction, and see a glowing marker over the next control. You do the clicking.

An experimental project for personal, noncommercial use. The bundled Sign in with ChatGPT DevKit has a noncommercial license; see [license notes](#license-notes).

## Run from source

Requires **Windows 10/11 x64**, **Node.js 22.12 or newer**, and an eligible ChatGPT account for AI guidance. Wispr Flow and ElevenLabs are optional; typing and Windows speech are built in.

```powershell
git clone https://github.com/dudujuju828/brinky.git
cd brinky
npm ci
npm run build
npm start
```

1. Open **Connection → Continue with ChatGPT**. Complete browser sign-in and enable ChatGPT plan usage. Account eligibility, available models, and usage limits are controlled by OpenAI.
2. Choose a model and the screen containing the app you want help with.
3. Type a question and press Enter, or click **Speak to Brinky** to use Windows speech. Wait for the microphone to be ready; a pause submits your question.
4. Follow the spoken instruction and glowing marker. Choose **Done, what’s next?** for a fresh screenshot and the next step.

**Try the glowing pointer** previews the marker without signing in or sharing a screenshot. The minus button keeps a small companion visible; × quits. The tray menu reopens Brinky.

## Hold to talk with Wispr Flow

1. Install and sign in to the Wispr Flow desktop app, then leave it running.
2. In Flow’s shortcut settings, add **Ctrl + Shift + F8** as a **Push to talk** binding.
3. In Brinky, choose **Connection → Voice input → Wispr Flow** and enable **Hold M4 to talk and send automatically**.
4. Hold **Ctrl + Shift + F8**, speak after Flow’s recording cue, then release. Brinky focuses its question box and submits Flow’s completed transcript automatically.

The current UI calls this shortcut **M4**, after the original setup’s keyboard macro key. Any keyboard can use Ctrl + Shift + F8 directly. A programmable keyboard can map a key to that chord, keeping it held until the physical key is released. No keyboard firmware is included.

Send or clear an existing draft first. **Esc**, **Stop**, or leaving Brinky cancels automatic sending. If Flow inserts no text, Brinky times out without sending. Regular typing and pasting still require Enter.

For manual dictation, use **Ctrl + Alt + B** to focus Brinky, dictate using your configured Flow shortcut, and press Enter. Brinky observes the hold shortcut without simulating or consuming it. Flow uses its own account and settings; Brinky needs no Flow API key.

## Reply voices

**Connection → Reply voice** switches between Windows speech and **ElevenLabs · George** using `eleven_flash_v2_5`. Windows is the default and needs no API key. ElevenLabs receives the assistant’s reply text and may incur charges on your own ElevenLabs account.

The ElevenLabs integration currently expects a locally provisioned key encrypted with Electron `safeStorage` at `%APPDATA%/Brinky/elevenlabs-key.bin`. This prototype does not yet include a key-entry screen or setup command. No key is distributed with this repository. Without a usable key, Brinky falls back to Windows speech. Never put a plaintext key in that file or in the source.

Recent speech audio is cached in memory so Repeat can reuse it. **Ctrl + Alt + Esc** stops pending guidance, speech playback, and the marker.

## Data and behavior

- A screenshot of the **whole selected display** is sent to OpenAI when you ask a question or request the next step. Keep the relevant app still while waiting.
- Screenshots remain in memory locally; Brinky does not save them to files. Conversation text remains in memory until New lesson, disconnect, or exit. Only the latest screenshot is attached to each request.
- Windows speech needs microphone permission and an installed speech recognition language. It prefers English (US) when available. Flow handles its own audio and transcription according to your Flow settings.
- Brinky briefly hides its windows while capturing the display. It shows guidance and does not click or type into the app you are learning.
- ChatGPT login uses OpenAI’s Sign in with ChatGPT DevKit and OAuth with PKCE. Credentials are encrypted with Windows-backed Electron `safeStorage` in `%APPDATA%/Brinky/chatgpt`. Brinky does not read existing ChatGPT or Codex credentials.
- **Manage usage** opens ChatGPT usage settings. **Disconnect** signs Brinky out. Model, screen, and voice preferences are saved in `%APPDATA%/Brinky/preferences.json`.
- API keys, login credentials, preferences, generated builds, and local test reports are excluded from this repository.

## Development and packaging

```powershell
npm run build    # Bundle the vendored ChatGPT runtime
npm start        # Open the app
npm run package  # Create release/Brinky-win32-x64/
```

After packaging, run `release/Brinky-win32-x64/Brinky.exe` and keep the other files in that folder beside it. No installer or administrator access is needed. Generated binaries are not committed to this repository.

Optional checks:

```powershell
npm test
npm run smoke
```

The smoke script opens an isolated app profile and uses a mock model. It exercises screen capture locally but sends no screenshots to a model and uses no ChatGPT account. Its output is stored in the ignored `.work/brinky-test/` directory. These checks do not establish live account eligibility, microphone behavior, or pointing accuracy.

The app uses Electron, a plain HTML/CSS/JavaScript interface, and PowerShell helpers for Windows speech and observing the Flow shortcut. The ChatGPT transport is vendored in `vendor/siwc-local`; `npm run build` generates `app/chatgpt-runtime.mjs`.

## Limitations

- Model pointing can be wrong, especially for small icons. Invalid boxes are discarded; the marker fades after 18 seconds. Each next step captures fresh context.
- Capture covers a display, not an individual app window. Multi-monitor scaling combinations need further field testing.
- Voice recognition depends on the microphone and chosen provider. Typing is always available.
- This is a prototype. The Flow handoff and ElevenLabs integration have not been covered by the included mock tests.

## License notes

The vendored [OpenAI Sign in with ChatGPT DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit) comes from commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`. Its [Noncommercial License](vendor/siwc-local/LICENSE) and [third-party notices](vendor/siwc-local/THIRD_PARTY_NOTICES.md) are retained. Brinky’s modifications to `types.ts` and `responses.ts` add validated screenshot messages and structured JSON output; the changed files are marked and those modifications use the same DevKit license.

There is currently no separate license grant for independently authored Brinky code. Publishing the source does not replace the licenses of bundled components or grant commercial-use rights to the DevKit.

The ChatGPT button mark comes from the DevKit and remains subject to the [OpenAI brand guidelines](https://openai.com/brand/). Brinky is an independent project and is not affiliated with OpenAI, Wispr, ElevenLabs, or Blender.

References: [Sign in with ChatGPT cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) · [Wispr Flow dictation guide](https://docs.wisprflow.ai/articles/6409258247-starting-your-first-dictation)
