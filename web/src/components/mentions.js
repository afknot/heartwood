// @mentions for the note editor. A mention is saved in Markdown as a link to the
// person's page, [@Name](/people/<id>), so it survives editing and export, and the
// server links that person to the note when it's saved.
import Mention from '@tiptap/extension-mention';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {{ current: { people: any[], createPerson: (name: string) => Promise<any> } }} ctx
 *   A ref so the suggestion list always sees the latest people.
 */
export function createMention(ctx) {
  return Mention.extend({
    addStorage() {
      return {
        markdown: {
          serialize(state, node) {
            state.write(`[@${node.attrs.label}](/people/${node.attrs.id})`);
          },
          parse: {} // saved mentions come back as links to /people/…, styled as mentions
        }
      };
    }
  }).configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${node.attrs.label}`,
    renderHTML: ({ options, node }) => ['a', { ...options.HTMLAttributes, href: `/people/${node.attrs.id}` }, `@${node.attrs.label}`],
    suggestion: {
      char: '@',
      allowSpaces: true,
      items: ({ query }) => {
        const q = query.toLowerCase().trim();
        const people = ctx.current.people || [];
        const matches = people
          .filter(p => !q || p.name.toLowerCase().includes(q) || (p.role || '').toLowerCase().includes(q))
          .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? -1 : 0) - (b.name.toLowerCase().startsWith(q) ? -1 : 0))
          .slice(0, 6)
          .map(p => ({ id: p.id, label: p.name, sub: p.role }));
        const exact = people.some(p => p.name.toLowerCase() === q);
        if (q.length >= 2 && !exact) matches.push({ create: true, label: query.trim().replace(/\s+/g, ' ') });
        return matches;
      },
      command: async ({ editor, range, props }) => {
        let item = props;
        if (item.create) {
          const p = await ctx.current.createPerson(item.label);
          if (!p) return;
          item = { id: p.id, label: p.name };
        }
        editor.chain().focus().insertContentAt(range, [
          { type: 'mention', attrs: { id: item.id, label: item.label } },
          { type: 'text', text: ' ' }
        ]).run();
      },
      render: () => {
        let el, items = [], index = 0, command = null;
        const draw = () => {
          if (!el) return;
          el.innerHTML = items.length
            ? items.map((it, i) => `<button type="button" class="mention-item${i === index ? ' on' : ''}" data-i="${i}">
                ${it.create ? `<span class="mention-add">+ Add “${esc(it.label)}” as a person</span>` : `<b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}`}
              </button>`).join('')
            : '<div class="mention-empty">Type a name</div>';
        };
        const place = rect => {
          if (!el || !rect) return;
          const r = rect();
          if (!r) return;
          const below = r.bottom + 6, h = el.offsetHeight || 200;
          el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
          el.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below}px`;
        };
        const pick = i => { const it = items[i]; if (it && command) command(it); };
        return {
          onStart: props => {
            items = props.items; index = 0; command = props.command;
            el = document.createElement('div');
            el.className = 'mention-menu';
            el.addEventListener('pointerdown', e => {
              e.preventDefault(); // keep focus in the editor
              const b = e.target.closest('[data-i]');
              if (b) pick(Number(b.dataset.i));
            });
            document.body.appendChild(el);
            draw(); place(props.clientRect);
          },
          onUpdate: props => { items = props.items; command = props.command; index = Math.min(index, Math.max(0, items.length - 1)); draw(); place(props.clientRect); },
          onKeyDown: ({ event }) => {
            if (!items.length) return false;
            if (event.key === 'ArrowDown') { index = (index + 1) % items.length; draw(); return true; }
            if (event.key === 'ArrowUp') { index = (index - 1 + items.length) % items.length; draw(); return true; }
            if (event.key === 'Enter' || event.key === 'Tab') { pick(index); return true; }
            if (event.key === 'Escape') { el?.remove(); el = null; return true; }
            return false;
          },
          onExit: () => { el?.remove(); el = null; }
        };
      }
    }
  });
}
