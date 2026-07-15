# Kid English Reading

A self-hosted English reading and pronunciation practice application for families.

The project provides a student practice interface, parent console, practice books,
PDF-assisted course import, recording, word-level feedback, optional speech
assessment providers, picture-book import, and a public in-memory product demo.

## Open-source edition

This repository contains source code only. It intentionally does **not** include:

- textbooks, commercial course content, PDFs, page images, or extracted text;
- third-party picture books, illustrations, or narration;
- speech-enhancement model files;
- student accounts, recordings, scores, SQLite databases, or logs;
- API keys, cloud credentials, deployment secrets, or production configuration.

You are responsible for ensuring that content imported into your own installation
is licensed for your use.

## Requirements

- Node.js 22.5 or newer
- npm 10 or newer
- A modern Chromium, Firefox, or Safari browser

## Run locally

### 1. Install

\`\`\`powershell
git clone https://github.com/qqhhhh/kid-english-reading.git
cd kid-english-reading
npm install
Copy-Item .env.example .env
\`\`\`

On macOS or Linux, use \`cp .env.example .env\`.

### 2. Start

\`\`\`powershell
npm run dev
\`\`\`

The development launcher starts:

- web interface: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:4175/api/health>
- no-account product demo: <http://127.0.0.1:5173/filing-review>

The demo uses in-memory sample data and does not write student progress.

### 3. Create a local family account

Generate a one-time local registration key:

\`\`\`powershell
npm run key:create:dev -- --label "local development" --days 30
\`\`\`

Open <http://127.0.0.1:5173/login>, choose registration, and use the generated
key to create a parent account. Development data is stored under
\`server/data/dev/\` and is ignored by Git.

## Default local behavior

The checked-in \`.env.example\` contains no cloud credentials:

- speech assessment uses the local mock provider;
- speech enhancement is disabled because no model is bundled;
- recording persistence is disabled by default;
- PDF text extraction and local OCR remain available;
- cloud TTS, cloud speech assessment, and cloud OCR require your own provider
  account and credentials.

The application can be opened and developed without any third-party key. Features
that require an external provider remain unavailable until you explicitly configure
one.

## Optional providers

Provider adapters are included, but credentials are never included. Configure only
the provider you intend to use in your private, untracked \`.env\` file.

| Capability | Provider | Environment variable names |
| --- | --- | --- |
| Speech assessment | Tencent | \`TENCENT_APP_ID\`, \`TENCENT_SECRET_ID\`, \`TENCENT_SECRET_KEY\` |
| Text to speech | Tencent | the Tencent variables above plus optional TTS settings |
| Shadow assessment | iFlytek | \`XFYUN_APP_ID\`, \`XFYUN_API_KEY\`, \`XFYUN_API_SECRET\` |
| Speech assessment | Azure | \`AZURE_SPEECH_KEY\`, \`AZURE_SPEECH_REGION\` |
| PDF OCR | iFlytek | \`XFYUN_PDF_OCR_APP_ID\`, \`XFYUN_PDF_OCR_SECRET\` |
| Vision review | SenseNova | \`SENSENOVA_API_KEY\` or its AK/SK variables |
| AI hints | OpenAI-compatible provider | \`OPENAI_API_KEY\`, \`OPENAI_MODEL\` |

Refer to each provider's official documentation for account creation, regional
availability, billing, and current API terms. Never place credentials in frontend
code or commit them to Git.

## Content and optional model files

- Official picture-book resources are not bundled. Families can upload books they
  are authorized to use.
- Textbook PDFs and generated page images stay under \`server/data/\`.
- The optional GTCRN enhancement model is not distributed here. If you have a
  properly licensed compatible ONNX model, set \`SPEECH_ENHANCEMENT_MODEL\` to
  its private local path and enable the provider in your untracked environment.
- Local HunyuanOCR integration expects a separately installed compatible service;
  models and executables are not distributed by this repository.

## Validation

\`\`\`powershell
npx tsc --noEmit
npm test
npm run build
\`\`\`

## Data and privacy

SQLite databases, uploaded PDFs, page images, recordings, TTS caches, and logs are
stored under \`server/data/\` and ignored by Git. Review your local retention
policy before collecting recordings from children. Cloud providers receive audio
or page samples only when you explicitly configure and enable the corresponding
adapter.

## License

Project source code is licensed under the [MIT License](LICENSE).
Third-party dependencies remain under their respective licenses. No license is
granted here for user-imported content or separately obtained models and media.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[SECURITY.md](SECURITY.md).
