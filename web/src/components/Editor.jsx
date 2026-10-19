import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { createMention } from './mentions.js';
import { pastedFiles, droppedFiles } from '../lib/pasteFiles.js';
import { useApp } from '../lib/context.js';
import { api } from '../api.js';
import Sheet from './Sheet.jsx';
import { PersonForm } from '../pages/People.jsx';

/**
 * A quiet WYSIWYG editor that reads and writes Markdown.
 * Markdown shortcuts work as you type: "# ", "- ", "1. ", "[ ] ", "> ", **bold**, _italic_.
 * Type @ to mention someone; mentioned people are linked to the note.
 */
export default function Editor({ value, onChange, placeholder = 'Start writing…', className = '', onFiles }) {
  const filesRef = useRef(onFiles);
  filesRef.current = onFiles;
  const [focused, setFocused] = useState(false);
  const { people, refreshPeople, notify } = useApp() || {};
  const ctx = useRef({ people: [], createPerson: async () => null });
  const [pending, setPending] = useState(null); // { name, resolve } while the "Add a person" sheet is open
  ctx.current.people = people || [];
  // "+ Add … as a person" from the @ list opens a short form; the mention is inserted once they're saved.
  ctx.current.createPerson = name => new Promise(resolve => setPending({ name, resolve }));
  const finish = p => { pending?.resolve(p); setPending(null); };
  async function savePerson(f) {
    try { const p = await api.post('/people', f); await refreshPeople?.(); notify?.(`Added ${p.name} to People`); finish(p); }
    catch (e) { notify?.(e.message); }
  }
  const mention = useMemo(() => createMention(ctx), []);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      mention,
      Markdown.configure({ html: false, tightLists: true, linkify: true, breaks: false, transformPastedText: true, transformCopiedText: true })
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange?.(editor.storage.markdown.getMarkdown()),
    onFocus: () => setFocused(true),
    onBlur: () => setTimeout(() => setFocused(false), 150),
    editorProps: {
      attributes: { spellcheck: 'true', autocapitalize: 'sentences' },
      // Pasted or dropped files (screenshots, photos, documents) become the note's attachments.
      handlePaste: (view, event) => {
        if (!filesRef.current) return false;
        const files = pastedFiles(event);
        if (!files.length) return false;
        filesRef.current(files);
        return true;
      },
      handleDrop: (view, event) => {
        if (!filesRef.current) return false;
        const files = droppedFiles(event);
        if (!files.length) return false;
        event.preventDefault();
        filesRef.current(files);
        return true;
      }
    }
  });

  // Replace content only when it changes from outside (e.g. transcript inserted).
  useEffect(() => {
    if (!editor || value === undefined) return;
    const current = editor.storage.markdown.getMarkdown();
    if (value !== current && !editor.isFocused) editor.commands.setContent(value || '', false);
  }, [value, editor]);

  if (!editor) return null;
  const b = (label, isOn, run, title) => (
    <button type="button" title={title} className={isOn ? 'on' : ''} onMouseDown={e => e.preventDefault()} onClick={run}>{label}</button>
  );
  const c = () => editor.chain().focus();

  return (
    <div className={`editor-wrap ${className}`}>
      <div className={`toolbar${focused ? ' show' : ''}`} role="toolbar" aria-label="Formatting">
        {b('B', editor.isActive('bold'), () => c().toggleBold().run(), 'Bold')}
        {b(<i>I</i>, editor.isActive('italic'), () => c().toggleItalic().run(), 'Italic')}
        {b('H', editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), 'Heading')}
        {b('•', editor.isActive('bulletList'), () => c().toggleBulletList().run(), 'Bullet list')}
        {b('1.', editor.isActive('orderedList'), () => c().toggleOrderedList().run(), 'Numbered list')}
        {b('☐', editor.isActive('taskList'), () => c().toggleTaskList().run(), 'Checklist')}
        {b('❝', editor.isActive('blockquote'), () => c().toggleBlockquote().run(), 'Quote')}
        {b('@', false, () => c().insertContent(' @').run(), 'Mention someone')}
        {b('↶', false, () => c().undo().run(), 'Undo')}
      </div>
      <EditorContent editor={editor} className="prose" />
      <Sheet open={!!pending} onClose={() => finish(null)} title="Add a person">
        {pending && <PersonForm key={pending.name} initial={{ name: pending.name }} compact submitLabel="Add and mention" onSubmit={savePerson} onCancel={() => finish(null)} />}
      </Sheet>
    </div>
  );
}

/** Append markdown to the end of an editor's markdown. */
export function appendMarkdown(md, addition) {
  return (md?.trim() ? md.trim() + '\n\n' : '') + addition;
}
