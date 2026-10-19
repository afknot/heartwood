// Files pasted or dropped into a text box: screenshots, photos, documents copied in Finder or
// Explorer. Copying from Word or a web page puts both text and a picture of it on the clipboard;
// in that case the text wins, so pasting words never turns into an attachment by surprise.

const stamp = () => new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/[/:]/g, '.');
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic' };

/** Give generic clipboard names ("image.png") a readable one. */
function named(f) {
  if (f.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)) return f;
  const ext = EXT[f.type] || 'png';
  return new window.File([f], `Pasted image ${stamp()}.${ext}`, { type: f.type || 'image/png' });
}

function fromTransfer(dt) {
  if (!dt) return [];
  const list = dt.files?.length ? [...dt.files] : [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  return list.map(named);
}

/** Files to attach from a paste event, or [] to let the paste go through as text. */
export function pastedFiles(e) {
  const files = fromTransfer(e.clipboardData);
  if (!files.length) return [];
  const text = e.clipboardData.getData('text/plain');
  const onlyImages = files.every(f => /^image\//.test(f.type));
  return onlyImages && text.trim() ? [] : files;
}

/** Files from a drop event. */
export const droppedFiles = e => fromTransfer(e.dataTransfer);

/** Props for an element that accepts dropped files; `over` styling is up to the caller. */
export function dropProps(onFiles, setOver = () => {}) {
  const has = e => [...(e.dataTransfer?.types || [])].includes('Files');
  return {
    onDragOver: e => { if (has(e)) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: e => { const f = droppedFiles(e); setOver(false); if (f.length) { e.preventDefault(); onFiles(f); } }
  };
}
