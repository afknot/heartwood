export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${url}`, opts);
  if (res.status === 401 && !url.startsWith('/auth')) window.dispatchEvent(new Event('heartwood:logged-out'));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}

export const api = {
  get: url => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: url => request('DELETE', url)
};

/** Upload with progress (fetch can't report upload progress). */
export function uploadRecording(blob, meta, onProgress) {
  return new Promise((resolve, reject) => {
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    form.append('audio', blob, `recording.${ext}`);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/entries/recording');
    xhr.withCredentials = true;
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401) window.dispatchEvent(new Event('heartwood:logged-out'));
        reject(new ApiError(data?.error || `Upload failed (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Network error — the recording is saved on this phone and will retry.', 0));
    xhr.send(form);
  });
}

/** Upload files for a new note, with progress. */
export function uploadFiles(files, meta, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    for (const f of files) form.append('files', f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/entries/files');
    xhr.withCredentials = true;
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401) window.dispatchEvent(new Event('heartwood:logged-out'));
        reject(new ApiError(data?.error || `Upload failed (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Network error. Check your connection and try again.', 0));
    xhr.send(form);
  });
}
