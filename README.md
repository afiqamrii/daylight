# Daylight

A small daily space inspired by quiet Japanese stationery, warm paper, and simple routines.

## Inside

- **My day:** task lists, priorities, time estimates, a shortlist that fits your time, a resumable focus timer, and notes.
- **Small rituals:** editable habits with seven-day history, a cup tracker, a one-minute breathing guide, a mood journal, and a sound corner with rain, warm noise, gentle chimes, three presets, and a sleep timer.
- **Little joys:** Momo the animated cat, a decision jar, and a sketchpad with undo, eraser, and PNG export.
- **Play a little:** matching tiles, Number Garden (a 2048-style puzzle with undo), and a solvable lantern logic puzzle. Progress and personal bests are saved.
- **My shelf:** a reading tracker with page progress and a finished-book collection, saved links, and a jar of happy moments to revisit.
- **Ask Kumo:** a friendly helper that can plan around your available time, suggest a smaller first step, prepare a task to add, and reflect on your small wins.
- **A small note for today:** 48 original comforting thoughts, a saved-thought collection, and a gentle daily reminder.
- **A tactile desk:** custom clay-style 3D artwork, a warm-light switch, small object navigation, a ceramic turntable, and gentle depth and motion. Find a space with **Ctrl/⌘ + K**.

Personal data is stored in this browser. The backup button exports every space as one JSON file; restoring validates the complete file before asking to replace data. Clearing browser storage removes local data. There is no cross-device sync. Use backups when moving browsers or devices.

Sound is generated on your device and starts only after you press Play. The sleep timer fades the mix to silence; reloading or restoring a backup keeps your mix settings but never resumes audio automatically. Older backups preserve newer collections when those sections are absent.

The 3D hero is a generated illustration with a light pointer tilt, supported by CSS objects and shadows. See [ASSETS.md](ASSETS.md) for the artwork prompt and provenance.

## Reminders

Open **A gentle nudge** to choose a time and enable a reminder while Daylight is open. For a reminder when the page is closed, download the daily calendar reminder and import the `.ics` file into your calendar. Downloading the file does not schedule it automatically. Your calendar controls notifications and timezone behavior.

## Kumo and optional on-device AI

The **lightweight helper** works immediately with built-in planning logic. It is clearly labelled and does not use a language model. It can offer useful actions without an account, API key, or model download.

For open-ended conversations, choose **Enable on-device AI**. A separate Web Worker selects the available local engine:

- **GPU:** [WebLLM 0.2.88](https://webllm.mlc.ai/docs/user/get_started.html), Qwen 2.5 0.5B, with model files cached in IndexedDB.
- **CPU fallback:** [Transformers.js 3.8.1](https://huggingface.co/docs/transformers.js/v3.8.1/en/installation), SmolLM2 135M, using single-threaded WebAssembly. It starts automatically when a WebGPU device is unavailable. **Use compatibility mode** selects it directly if your GPU has trouble. Responses may be slower and simpler.

The initial download is roughly 180–300 MB plus runtime files and needs internet and sufficient memory. Public model assets come from Hugging Face and the official MLC repositories; runtimes come from jsDelivr/esm.run. Messages are processed locally, never sent to a model API. These small models can make mistakes. Browser and network restrictions may prevent setup; the lightweight helper remains usable.

Kumo shows a thinking animation and reveals responses gradually. Stop keeps only the text you have seen. Reduced-motion preferences remove the artificial preparation delay and typing animation. Model computation can still take time.

The optional context toggle shares only tasks and habit counts with Kumo's local logic/model. Notes and journal entries are excluded. Chat history is saved locally and included in backups. Turning AI off releases its worker; cached model files remain for reuse and can be removed through your browser's site-data settings.

## Run locally

Requires Python 3, or any ordinary static HTTP server:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4173/. ES modules need an HTTP server; opening index.html directly as a file will not work in every browser.

## Checks

```sh
node --test tests/*.test.mjs
```

The core site has no installed JavaScript dependencies or build step. `dist/` is the published static output. The optional AI runtime is loaded only after enabling it. Google Fonts is optional; system fonts are used when unavailable. Reduced-motion preferences turn off decorative animations. No analytics, paid API, or external personal-data backend is included.
