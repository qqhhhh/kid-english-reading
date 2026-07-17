# Kid English Reading

A self-hosted English reading and pronunciation practice application for families.

The current open-source release tracks application version **v0.7.3**. It provides
a child-friendly practice interface, a parent console, practice books, PDF-assisted
course import, browser recording, streaming-first speech assessment, word-level
feedback, scoring diagnostics, and a public in-memory product demo.

## Highlights

- React 19, Vite, strict TypeScript, Express, WebSocket, and SQLite.
- Parent accounts, household isolation, and revocable child-device pairing.
- Vocabulary, sentence, and paragraph practice with reference audio and automatic
  progression only after the current required item passes.
- AudioWorklet capture, browser voice activity detection, 16 kHz PCM streaming,
  final-result identity checks, and one complete-recording fallback.
- Word-level accuracy, completeness, fluency, missed-word handling, recording
  validity checks, and policy-normalized historical best scores.
- PDF layout parsing, Tesseract-based verification, optional local OCR adapters,
  quality reports, and a human review workflow.
- A parent diagnostics workspace for recordings, device metadata, provider results,
  and human calibration labels.
- 144 automated tests plus multi-device browser layout checks.

## Open-source edition

This repository contains source code only. It intentionally does **not** include:

- textbooks, commercial course content, PDFs, page images, or extracted text;
- third-party picture books, illustrations, or narration;
- speech-enhancement or OCR model weights and executables;
- student accounts, recordings, scores, SQLite databases, or logs;
- API keys, cloud credentials, production secrets, or deployment-specific settings.

You are responsible for ensuring that content imported into your installation is
licensed for your use.

## Built with Codex and GPT-5.6

Kid English Reading was developed from the initial family conversation through
the OpenAI Build Week submission with **Codex** as the engineering workspace and
**GPT-5.6** as the reasoning and coding model. Their role was in the development
process; the released application does not require Codex or call GPT-5.6 at
runtime.

### How Codex was used

Codex provided the repository-aware workflow used to build and maintain the
project. It was used to:

- inspect the existing React, Express, WebSocket, SQLite, and test code before
  making changes;
- turn product decisions into scoped implementation plans and keep private
  family data separate from the source-only public edition;
- edit the full stack, run local development services, inspect browser behavior,
  and diagnose integration failures;
- execute type checking, automated tests, production builds, and diff checks
  after changes; and
- review the final public repository and create the Build Week demonstration
  video without exposing credentials, recordings, textbooks, or family data.

### How GPT-5.6 was used

GPT-5.6 supplied the reasoning and code-generation capabilities inside that
workflow. It helped translate a parent's practical requirements into technical
behavior, including:

- designing the parent-to-child learning loop, device pairing, and household
  isolation model;
- migrating the browser and server code to strict TypeScript and strengthening
  shared API boundaries;
- debugging `AudioWorklet` capture, voice activity detection, 40 ms PCM streaming,
  WebSocket final-result identity, and the single full-recording fallback;
- defining scoring invariants so silence, incomplete readings, or a missed
  required word cannot be hidden by a high average score;
- building the deterministic PDF layout, local OCR comparison, quality-gate, and
  human-review pipeline for messy textbook pages; and
- expanding regression coverage to 144 automated tests while hardening
  authentication, child-device access, recording privacy, and provider error
  handling.

The repeated development loop was:

1. define the observable behavior and safety boundary;
2. inspect the relevant implementation and data flow with Codex;
3. use GPT-5.6 to reason about and implement a focused change;
4. run type checks, tests, builds, and targeted browser verification; and
5. inspect the diff and refine the result before committing.

Watch the [OpenAI Build Week demonstration video](https://youtu.be/wOXfG1ai3bk)
for the product story and a short walkthrough of this development process.

## Requirements

- Node.js 22.5 or newer
- npm 10 or newer
- A modern Chromium, Firefox, or Safari browser

## Run locally

```powershell
git clone https://github.com/qqhhhh/kid-english-reading.git
cd kid-english-reading
npm install
Copy-Item .env.example .env
npm run dev
```

On macOS or Linux, use `cp .env.example .env`.

The development launcher starts:

- web interface: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:4175/api/health>
- no-account product demo: <http://127.0.0.1:5173/filing-review>

The demo uses in-memory sample data and does not write student progress.

### Create a local family account

```powershell
npm run key:create:dev -- --label "local development" --days 30
```

Open <http://127.0.0.1:5173/login>, choose registration, and use the generated
key to create a parent account. Development data is stored under
`server/data/dev/` and is ignored by Git.

## Safe defaults

The checked-in `.env.example` contains no cloud credentials:

- speech assessment uses the local mock provider;
- speech enhancement and recording persistence are disabled;
- no demo family or course data is written automatically;
- PDF text extraction and bundled Tesseract verification remain available;
- cloud TTS, assessment, and optional OCR require your own provider credentials.

Provider credentials must stay in the backend's untracked `.env` file. The browser
never receives cloud API secrets. Tencent speech assessment and TTS, iFlytek and
Azure diagnostic assessment, and local HunyuanOCR/PaddleOCR adapters are optional.

The OpenAI TTS and AI-hint boundaries are reserved but are not implemented in this
release; the project does not claim to call the OpenAI API at runtime.

## Optional content and models

- Families can import content they are authorized to use.
- Uploaded PDFs, generated page images, recordings, and caches stay under
  `server/data/`.
- The optional GTCRN enhancement model is not distributed. Point
  `SPEECH_ENHANCEMENT_MODEL` at a compatible model you are licensed to use.
- HunyuanOCR and PaddleOCR integrations expect separately installed local services;
  their model files and runtimes are not distributed by this repository.

## Validation

```powershell
npm run typecheck
npm run build
npm test
git diff --check
```

## Data and privacy

SQLite databases, uploaded files, recordings, TTS caches, and logs are ignored by
Git. Review consent, retention, and cloud-provider policies before collecting or
processing children's recordings. Back up SQLite and its WAL state before any
migration or bulk repair.

## License

Project source code is licensed under the [MIT License](LICENSE). Third-party
dependencies remain under their respective licenses. No license is granted here
for user-imported content or separately obtained models and media.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[SECURITY.md](SECURITY.md).
