import path from 'node:path';
import fs from 'node:fs';

const env = process.env;

// Keys can also be entered in Settings (see vault.js, which registers itself here on startup).
let secretSource = name => '';
export function setSecretSource(fn) { secretSource = fn; }
const pick = (name, envName) => secretSource(name) || env[envName] || '';

export const config = {
  port: Number(env.PORT || 3000),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  appPassword: env.APP_PASSWORD || '',
  cookieSecure: env.COOKIE_SECURE !== 'false',
  sessionDays: Number(env.SESSION_DAYS || 90),
  webDist: path.resolve(env.WEB_DIST || path.join(import.meta.dirname, '../../web/dist')),
  keys: {
    get anthropic() { return pick('anthropic_api_key', 'ANTHROPIC_API_KEY'); },
    get openai() { return pick('openai_api_key', 'OPENAI_API_KEY'); },
    get gemini() { return pick('gemini_api_key', 'GEMINI_API_KEY'); }
  },
  // Fine-grained GitHub token limited to your portfolio repo (Contents + Pull requests: read and write).
  // Stays on the server; never sent to the browser.
  get githubToken() { return pick('github_token', 'GITHUB_TOKEN'); },
  whisperUrl: (env.WHISPER_URL || '').replace(/\/$/, ''),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 500)
};

export const audioDir = path.join(config.dataDir, 'audio');
export const tmpDir = path.join(config.dataDir, 'tmp');
export const filesDir = path.join(config.dataDir, 'files');
for (const d of [config.dataDir, audioDir, tmpDir, filesDir]) fs.mkdirSync(d, { recursive: true });

// Defaults for anything the user can change on the Settings screen.
// Model IDs change often; every one of these can be edited in the app.
export const DEFAULT_SETTINGS = {
  ai_provider: 'anthropic',
  models: {
    anthropic: 'claude-sonnet-5-5',
    openai: 'gpt-5.6-sol',
    gemini: 'gemini-3.6-flash'
  },
  transcribe_provider: 'local',
  transcribe_models: {
    openai: 'gpt-transcribe',
    gemini: 'gemini-3.6-flash'
  },
  auto_analyze: true,
  auto_organize: true,
  delete_audio_after_transcribe: false,
  notifications: {
    morning: true,
    morning_time: '08:00',
    auto_prep: true,
    before: false,
    before_min: 15,
    after: true,
    weekly: true,
    weekly_day: 5,
    weekly_time: '16:00',
    evening: true,                  // end-of-day reflection prompt, weekdays
    evening_time: '17:30',
    show_names: true
  },
  career: {
    repo: '',                       // owner/name of your portfolio repo, e.g. you/your-portfolio
    branch: 'main',
    story_dir: 'content/stories',
    record_path: 'content/career.json'
  },
  profile: {
    name: '',
    role: '',
    team: '',
    goals: '',
    leadership_aspirations: '',
    leadership_styles: ''           // comma-separated ids from leadership.js, e.g. 'servant,space'
  }
};

export function availableProviders() {
  return {
    analysis: {
      anthropic: !!config.keys.anthropic,
      openai: !!config.keys.openai,
      gemini: !!config.keys.gemini
    },
    transcription: {
      local: !!config.whisperUrl,
      openai: !!config.keys.openai,
      gemini: !!config.keys.gemini
    }
  };
}
