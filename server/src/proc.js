// Running the converters (ffmpeg, pdftotext, heif-convert…) on files people upload, safely:
// a time limit, a cap on how much output is kept, and for ffmpeg, local files and known media
// formats only, so a file dressed up as a photo or recording can't make it fetch URLs or read
// other files (playlists, concat lists and the like).
import { spawn } from 'node:child_process';

const MB = 1024 * 1024;

/**
 * Run a command with arguments (never through a shell).
 * @param {{ timeoutMs?: number, maxOut?: number, binary?: boolean, makeError?: (msg: string) => Error }} [o]
 */
export function runCommand(cmd, args, { timeoutMs = 120000, maxOut = 64 * MB, binary = false, makeError } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; let size = 0, err = '', killed = '';
    const fail = msg => reject(makeError ? makeError(msg) : new Error(msg));
    const timer = setTimeout(() => { killed = 'took too long'; p.kill('SIGKILL'); }, timeoutMs);
    p.stdout.on('data', d => {
      size += d.length;
      if (size > maxOut) { killed = 'produced too much output'; p.kill('SIGKILL'); return; }
      out.push(d);
    });
    p.stderr.on('data', d => { if (err.length < 8000) err += d; });
    p.on('error', e => { clearTimeout(timer); fail(`${cmd} couldn’t start: ${e.message}`); });
    p.on('close', code => {
      clearTimeout(timer);
      if (killed) return fail(`${cmd} stopped: the file ${killed}.`);
      const buf = Buffer.concat(out);
      if (code === 0) resolve(binary ? buf : buf.toString('utf8'));
      else fail(`${cmd} failed: ${err.slice(-300)}`);
    });
  });
}

const PROTOCOLS = ['-protocol_whitelist', 'file,pipe'];
const AUDIO_FORMATS = 'mov,matroska,webm,ogg,mp3,wav,aac,flac,caf,amr,mpegts,asf';
const IMAGE_FORMATS = 'image2,jpeg_pipe,png_pipe,webp_pipe,gif,gif_pipe,bmp_pipe,tiff_pipe';

/** Input options to put before ffmpeg's/ffprobe's -i for an uploaded recording. */
export const AUDIO_INPUT = [...PROTOCOLS, '-format_whitelist', AUDIO_FORMATS];
/** Input options to put before ffmpeg's -i for an uploaded photo. */
export const IMAGE_INPUT = [...PROTOCOLS, '-format_whitelist', IMAGE_FORMATS];
