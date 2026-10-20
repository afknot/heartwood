// "Something to try": one small way to show up today, picked to fit the day you have.
// Written for Heartwood in its own words, drawing on ideas from Dale Carnegie's
// How to Win Friends and Influence People and How to Enjoy Your Life and Your Job,
// and Thich Nhat Hanh's The Art of Communicating, and from servant leadership and the leaders and
// researchers credited below. No text from their books is reproduced.
import { db, now, getSettings } from './db.js';
import { chosenStyles, quoteForDay, STYLES } from './leadership.js';
import { agenda } from './agenda.js';
import { local, startOfLocalDay, addDays } from './localtime.js';

const CARNEGIE = 'Dale Carnegie, How to Win Friends and Influence People';
const ENJOY = 'Dale Carnegie, How to Enjoy Your Life and Your Job';
const TNH = 'Thich Nhat Hanh, The Art of Communicating';
const GREENLEAF = 'Robert K. Greenleaf, The Servant as Leader';
const MARQUET = 'L. David Marquet, Turn the Ship Around!';
const NETFLIX = 'Reed Hastings and Erin Meyer, No Rules Rules';
const EDMONDSON = 'Amy Edmondson, The Fearless Organization';
const MBS = 'Michael Bungay Stanier, The Coaching Habit';
const SCOTT = 'Kim Scott, Radical Candor';
const BROWN = 'Brené Brown, Dare to Lead';
const CHAPMAN = 'Bob Chapman, Everybody Matters';
const NVC = 'Marshall Rosenberg, Nonviolent Communication';
const MEDIATION = 'interest-based conflict resolution';
const GROVE = 'Andy Grove, High Output Management';
const TNG = ep => `Star Trek: The Next Generation, “${ep}”`;
const TOS = ep => `Star Trek, “${ep}”`;

// fit: when it suits the day. talk = needs a conversation today; busy = a full day; any = always.
export const PRACTICES = [
  // Connection
  { id: 'their-name', fit: 'talk', styles: ['empathetic'], source: CARNEGIE, title: 'Say their name',
    how: 'Use the person’s name, warmly, at the start and end of the conversation. If you’re unsure how to say it, ask. It’s a small signal that you see them, not just the agenda.' },
  { id: 'one-more-question', fit: 'talk', styles: ['coach'], source: CARNEGIE, title: 'Ask one more question',
    how: 'When someone tells you something, ask a follow-up before offering your own take. Let them go further into what they care about.' },
  { id: 'open-warm', fit: 'talk', styles: ['empathetic'], source: CARNEGIE, title: 'Spend the first minute on them',
    how: 'Before the agenda, ask about something you know matters to them: a project, a trip, something they mentioned last time. Mean it, then get to work.' },
  { id: 'talk-less', fit: 'talk', styles: ['coach', 'servant'], source: CARNEGIE, title: 'Let them do most of the talking',
    how: 'Aim to speak for about a third of the conversation. When you feel the urge to fill a pause, wait a beat. People often say the important thing after the silence.' },
  { id: 'their-idea', fit: 'talk', styles: ['coach', 'space'], source: CARNEGIE, title: 'Let the idea be theirs',
    how: 'Instead of handing over the answer, ask questions that help them get there. When they do, give them the credit, out loud.' },
  { id: 'ask-dont-tell', fit: 'talk', styles: ['space', 'coach'], source: CARNEGIE, title: 'Turn one instruction into a question',
    how: 'Pick something you’d normally just assign and ask it instead: “What would it take to…?” or “How would you approach…?” Notice how the ownership shifts.' },
  { id: 'their-side', fit: 'talk', styles: ['mediator'], source: CARNEGIE, title: 'Make their case first',
    how: 'Before a disagreement, write down the best version of the other person’s view. Open by saying it back to them, then add yours.' },
  { id: 'skip-the-argument', fit: 'any', styles: ['mediator'], source: CARNEGIE, title: 'Let one argument go',
    how: 'Notice a debate today that doesn’t really matter and let the other person have it. Save your energy, and their goodwill, for the ones that do.' },
  { id: 'own-it-fast', fit: 'any', styles: ['candid', 'empathetic'], source: CARNEGIE, title: 'Own a mistake quickly',
    how: 'If you got something wrong lately, say so plainly and first, before anyone has to point it out. It makes it easier for your team to do the same.' },

  // Appreciation and feedback
  { id: 'specific-thanks', fit: 'any', styles: ['servant'], source: CARNEGIE, title: 'Thank someone specifically',
    how: 'Tell one person exactly what they did and why it mattered: not “great job” but “the way you framed the tradeoffs got us unstuck.” Sincere and specific beats big.' },
  { id: 'reputation', fit: 'talk', styles: ['coach', 'visionary'], source: CARNEGIE, title: 'Name the strength you see',
    how: 'Tell someone a strength you see in them and that you’re counting on it. People tend to grow into the version of themselves you believe in.' },
  { id: 'small-progress', fit: 'any', styles: ['coach'], source: CARNEGIE, title: 'Notice a small improvement',
    how: 'Look for someone getting a little better at something and tell them. Early, small encouragement is worth more than a big compliment later.' },
  { id: 'your-miss-first', fit: 'talk', styles: ['candid', 'mediator'], source: CARNEGIE, title: 'Go first with your own misstep',
    how: 'If you have hard feedback to give, start with something you’ve gotten wrong yourself. It turns a verdict into a conversation between two people learning.' },
  { id: 'private-public', fit: 'any', styles: ['candid'], source: CARNEGIE, title: 'Credit in public, correct in private',
    how: 'Give one piece of recognition where others can see it today. Keep anything corrective one-on-one, and leave the person room to save face.' },
  { id: 'doable', fit: 'talk', styles: ['coach'], source: CARNEGIE, title: 'Make the fix feel doable',
    how: 'When something needs to change, make the next step small and clear, and say you think they can do it. Big problems shrink when the first move is obvious.' },
  { id: 'what-they-want', fit: 'any', styles: ['visionary', 'mediator'], source: CARNEGIE, title: 'Start from what they want',
    how: 'Before asking someone for something today, think about what’s in it for them, and lead with that. Requests land better when they connect to the other person’s goals.' },
  { id: 'quality-not-task', fit: 'any', styles: ['servant', 'empathetic'], source: TNH, title: 'Appreciate a quality, not just a task',
    how: 'Tell someone a quality of theirs you value, like their patience, their candor or their care with details. It’s a way of watering the good in them.' },

  // Listening and speaking with care
  { id: 'three-breaths', fit: 'busy', source: TNH, title: 'Three breaths before each meeting',
    how: 'Before you join each conversation today, take three slow breaths. Arrive in the room before the agenda does.' },
  { id: 'listen-to-understand', fit: 'talk', styles: ['empathetic', 'mediator', 'servant'], source: TNH, title: 'Listen only to understand',
    how: 'In one conversation, listen with a single purpose: helping the other person say what they need to say. Don’t fix, correct or advise unless they ask.' },
  { id: 'here-for-you', fit: 'talk', styles: ['empathetic', 'servant'], source: TNH, title: 'Be fully there',
    how: 'Put your phone away and close other windows for one conversation. Let the person know, in your own words, that you’re there for them.' },
  { id: 'name-whats-hard', fit: 'talk', styles: ['empathetic'], source: TNH, title: 'Acknowledge what’s hard',
    how: 'If someone is carrying something difficult, say you see it before getting into the work. Being acknowledged often helps more than a solution.' },
  { id: 'ask-for-help', fit: 'any', styles: ['empathetic'], source: TNH, title: 'Say what you need',
    how: 'Tell a peer, your manager or a friend about something you’re finding hard right now. Leaders need support too, and asking models it for your team.' },
  { id: 'reread', fit: 'any', styles: ['mediator'], source: TNH, title: 'Reread before you send',
    how: 'Before sending a tense message, read it once as the person receiving it. Keep what’s true and useful; soften or cut what’s only there to win.' },
  { id: 'wait-a-day', fit: 'any', styles: ['mediator'], source: TNH, title: 'Give a sting a day',
    how: 'If something someone said hurt, write yourself a short note about it and wait a day before you respond. Then talk about it calmly, if it still matters.' },
  { id: 'clear-the-air', fit: 'any', styles: ['mediator', 'candid'], source: TNH, title: 'Clear the air',
    how: 'Is there something you said or did lately that you regret? Tell the person simply, without a long explanation. Small repairs keep relationships easy.' },

  // Energy and steadiness
  { id: 'rest-early', fit: 'busy', source: ENJOY, title: 'Rest before you’re tired',
    how: 'Take five minutes between meetings today, before you feel you need it. A short break early saves more energy than a long one late.' },
  { id: 'walk-between', fit: 'busy', source: TNH, title: 'Walk slowly to the next thing',
    how: 'Between two meetings, walk somewhere (even a hallway or around the room) with your phone in your pocket. Feel your feet. Then go in.' },
  { id: 'just-the-tea', fit: 'any', source: TNH, title: 'One cup, nothing else',
    how: 'Have your coffee or tea today without a screen. Just the cup, the warmth and a few minutes of not thinking about work.' },
  { id: 'bell', fit: 'busy', source: TNH, title: 'Set a pause bell',
    how: 'Set a reminder every two hours. When it goes off, stop, take three breaths and loosen your shoulders, then carry on.' },
  { id: 'clear-desk', fit: 'any', source: ENJOY, title: 'Clear the decks for one thing',
    how: 'Close everything except what you need for your most important task. A cluttered screen makes a busy day feel busier than it is.' },
  { id: 'most-important-first', fit: 'any', source: ENJOY, title: 'Do the most important thing first',
    how: 'Choose the one thing that would make today a good day, and do it before you open your messages.' },
  { id: 'decide-it', fit: 'any', styles: ['visionary'], source: ENJOY, title: 'Decide something now',
    how: 'Is there a decision you’ve been carrying that you already have the facts for? Make it today, and let it stop taking up space.' },
  { id: 'hand-it-off', fit: 'any', styles: ['space'], source: ENJOY, title: 'Hand one thing off',
    how: 'Give someone on your team a piece of work they could grow from, along with the context and the decision rights. It’s a gift, not a dump.' },
  { id: 'act-interested', fit: 'any', source: ENJOY, title: 'Be curious about the dull task',
    how: 'Pick the task you’re dreading and approach it as if it were interesting. Ask what you could learn from it. Feelings often follow what you do.' },
  { id: 'count-whats-working', fit: 'any', source: ENJOY, title: 'Count what’s going right',
    how: 'Write down three things that are working: on your team, in your work or in your life. On heavy days, the list is still there.' },
  { id: 'useful-bit', fit: 'any', source: ENJOY, title: 'Keep the useful bit of criticism',
    how: 'If you’ve had criticism lately, pull out the part that’s useful, act on that, and let the rest go. You don’t have to carry all of it.' },
  { id: 'your-way', fit: 'any', styles: ['visionary'], source: ENJOY, title: 'Lead like yourself',
    how: 'Find one moment today to do something your own way, not the way you think a leader is supposed to. Your team trusts the real you more.' },
  { id: 'kind-inner-voice', fit: 'busy', source: TNH, title: 'Talk to yourself like your team',
    how: 'When you notice harsh self-talk today, ask what you’d say to someone on your team in the same spot, and say that to yourself instead.' },
  // Giving space
  { id: 'i-intend', fit: 'talk', styles: ['space'], source: MARQUET, title: 'Invite “I intend to…”',
    how: 'When someone asks what they should do, ask what they’d do. Invite them to come back with “I intend to…” and their reasoning, and let them go ahead unless there’s a real reason not to.' },
  { id: 'talk-last', fit: 'talk', styles: ['space', 'coach'], source: MARQUET, title: 'Talk last',
    how: 'In a meeting where a decision is being made, hold your view until everyone else has spoken, even if you think you know the answer.' },
  { id: 'decision-down', fit: 'any', styles: ['space'], source: MARQUET, title: 'Move one decision down',
    how: 'Find a decision that comes to you only out of habit, and give it to the person closest to the information. Tell them what would make you want to hear about it.' },
  { id: 'context-not-control', fit: 'any', styles: ['space', 'visionary'], source: NETFLIX, title: 'Give context instead of instructions',
    how: 'Before you hand something off, share the why, what good looks like, the risks and the constraints, then leave the how to them. If it goes sideways, first ask what context was missing.' },
  { id: 'no-redo', fit: 'any', styles: ['space'], source: MARQUET, title: 'Don’t redo it',
    how: 'When work comes back different from how you’d have done it, ask whether it’s wrong or just not yours. If it meets the goal, ship it as it is and say what’s good about it.' },
  { id: 'check-in-not-up', fit: 'talk', styles: ['space', 'servant'], source: GROVE, title: 'Let them set the agenda',
    how: 'In your next 1:1, open with “What do you want to make sure we cover?” and take their list first. Yours can wait or go in a message.' },
  { id: 'step-back', fit: 'any', styles: ['space'], source: MARQUET, title: 'Step back so someone can step forward',
    how: 'Pick one thing you’d normally lead today, a meeting, a reply or a review, and ask someone on your team to take it. Be there as backup, not the driver.' },

  // Mediating rather than reprimanding
  { id: 'separately-first', fit: 'any', styles: ['mediator'], source: MEDIATION, title: 'Hear each side on its own first',
    how: 'If two people are at odds, talk with each of them separately before bringing them together. Ask what happened, what they need and what they’d like to happen next, and just listen.' },
  { id: 'interests', fit: 'talk', styles: ['mediator'], source: MEDIATION, title: 'Look under the position',
    how: 'When someone insists on something, ask what it would give them: “What’s important to you about that?” The need underneath is usually easier to solve than the demand.' },
  { id: 'observe-not-judge', fit: 'any', styles: ['mediator', 'candid'], source: NVC, title: 'Describe it without a verdict',
    how: 'Raise one issue today by saying what you saw, how it landed for you, what you need, and a specific request. Leave out words like “always,” “never” and labels for the person.' },
  { id: 'repair-not-reprimand', fit: 'talk', styles: ['mediator', 'empathetic'], source: MEDIATION, title: 'Aim for repair, not a reprimand',
    how: 'When something went wrong between people, ask yourself what would make the working relationship whole again, and steer the conversation there instead of toward blame.' },
  { id: 'agree-and-follow-up', fit: 'any', styles: ['mediator'], source: MEDIATION, title: 'Close the loop on a tension',
    how: 'Think of a disagreement that was “resolved” recently. Check in with the people involved: is what you agreed actually working?' },
  { id: 'what-happened', fit: 'talk', styles: ['mediator', 'coach'], source: EDMONDSON, title: 'Ask what happened before deciding what it means',
    how: 'When you hear about a mistake or a conflict, start with curiosity: “Walk me through what happened.” Thank the person for telling you, then work out the fix together.' },

  // Coaching
  { id: 'and-what-else', fit: 'talk', styles: ['coach'], source: MBS, title: 'Ask “And what else?”',
    how: 'When someone answers your question, ask “And what else?” once or twice before you respond. The first answer is rarely the only one, or the most important.' },
  { id: 'real-challenge', fit: 'talk', styles: ['coach', 'mediator'], source: MBS, title: 'Find the real challenge',
    how: 'When someone brings you a problem, ask what the real challenge is for them, before you start solving. It often isn’t the one they led with.' },
  { id: 'how-can-i-help', fit: 'talk', styles: ['coach', 'servant'], source: MBS, title: 'Ask how you can help, and mean it',
    how: 'Instead of assuming what someone needs, ask “How can I help?” and let them tell you. You might be asked for less, or for something different, than you expected.' },
  { id: 'advice-later', fit: 'talk', styles: ['coach'], source: MBS, title: 'Hold the advice for ten minutes',
    how: 'In one conversation, notice the urge to give advice and wait. Ask one more question first. If they still want your view after that, give it.' },

  // Serving
  { id: 'remove-obstacle', fit: 'any', styles: ['servant'], source: GREENLEAF, title: 'Remove one obstacle',
    how: 'Ask someone on your team what’s slowing them down that you could clear, like an approval, a missing decision or a meeting they don’t need, and clear it today.' },
  { id: 'grow-as-persons', fit: 'any', styles: ['servant', 'coach'], source: GREENLEAF, title: 'Ask whether they’re growing',
    how: 'Pick one person on your team and ask yourself honestly whether they’re growing under your leadership. If you’re not sure, ask them what would help them grow next.' },
  { id: 'listen-first', fit: 'talk', styles: ['servant', 'empathetic'], source: CHAPMAN, title: 'Listen first, all the way through',
    how: 'In your next conversation, let the other person finish completely, then reflect back what you heard before saying anything of your own.' },
  { id: 'stewardship', fit: 'any', styles: ['servant', 'visionary'], source: GREENLEAF, title: 'Lead for the long run',
    how: 'Make one decision today with the team a year from now in mind, not just this week’s deadline. What would you want to have built for them?' },
  { id: 'five-to-one', fit: 'any', styles: ['servant', 'empathetic'], source: CHAPMAN, title: 'Recognize more than you correct',
    how: 'Keep a rough count today of how often you recognize people versus correct them. Tip it toward recognition: specific, sincere and timely.' },

  // Empathy, candor and safety
  { id: 'own-fallibility', fit: 'talk', styles: ['empathetic', 'candid'], source: EDMONDSON, title: 'Say what you don’t know',
    how: 'In a meeting today, say plainly something you’re unsure about or a call you got wrong. It makes it safer for everyone else to do the same.' },
  { id: 'invite-dissent', fit: 'talk', styles: ['empathetic', 'mediator'], source: EDMONDSON, title: 'Ask for the disagreement',
    how: 'Before a decision closes, ask “What are we missing?” or “Who sees this differently?” and thank whoever answers, especially if it’s uncomfortable.' },
  { id: 'clear-is-kind', fit: 'any', styles: ['candid', 'empathetic'], source: BROWN, title: 'Be clear, because it’s kind',
    how: 'Is there an expectation you’ve left fuzzy to avoid an awkward moment? Make it clear today: what you need, by when, and what good looks like.' },
  { id: 'ask-feedback-first', fit: 'talk', styles: ['candid', 'coach'], source: SCOTT, title: 'Ask for feedback first',
    how: 'Ask someone what you could do, or stop doing, that would make it easier to work with you. Then stay quiet long enough for a real answer.' },
  { id: 'say-it-soon', fit: 'any', styles: ['candid'], source: SCOTT, title: 'Give the feedback you’ve been holding',
    how: 'Is there feedback you’ve been sitting on? Give it today, in person, briefly: what you saw, why it matters and a suggested next step.' },
  { id: 'why-it-matters', fit: 'talk', styles: ['visionary'], source: NETFLIX, title: 'Connect their work to the why',
    how: 'In one conversation, tell someone how their work connects to where the team is going, and ask how they see it.' },

  // From the bridge of the Enterprise
  { id: 'brief-then-decide', fit: 'any', styles: ['space', 'coach'], source: TNG('the senior staff briefings'), title: 'Brief, then decide',
    how: 'Before a big call, ask two or three people for their read and their recommendation, the way a captain gathers the senior staff. Then decide, and say why.' },
  { id: 'make-it-so', fit: 'any', styles: ['space'], source: TNG('Encounter at Farpoint'), title: 'Make it so',
    how: 'Once a decision is made, hand the how to the person running it, and stay out of it. Ask to hear when it’s done, or if something changes.' },
  { id: 'away-team', fit: 'talk', styles: ['space', 'servant'], source: TNG('the away missions'), title: 'Send the away team',
    how: 'Let someone on your team lead a meeting or a visit you’d normally lead. Brief them, then let them speak for the team, and back them up afterwards.' },
  { id: 'no-mistakes-still-lose', fit: 'any', styles: ['coach', 'empathetic'], source: TNG('Peak Performance'), title: 'Say it out loud: the call was right',
    how: 'When something someone owned didn’t work out, separate the decision from the result. If they made a good call with what they knew, tell them so.' },
  { id: 'first-duty', fit: 'any', styles: ['candid'], source: TNG('The First Duty'), title: 'Tell the whole story',
    how: 'In an update today, include the part that didn’t go well, plainly. Teams copy what their leader does with bad news.' },
  { id: 'bridge-norms', fit: 'any', styles: ['candid', 'servant'], source: TOS('Balance of Terror'), title: 'Hold the line on how we treat each other',
    how: 'If you see someone dismissed, talked over or stereotyped, say so right then, calmly, in the room. Norms are set by what the leader lets pass.' },
  { id: 'counselor', fit: 'talk', styles: ['empathetic', 'mediator'], source: TNG('Counselor Troi on the bridge'), title: 'Ask how it feels, not just what they think',
    how: 'After you share a decision, ask one person how it lands for them. The reaction under the logic is often where the real concern is.' },
  { id: 'more-facts', fit: 'any', styles: ['mediator', 'coach'], source: TOS('Space Seed'), title: 'Get one more fact first',
    how: 'Before you react to a report of a problem today, ask one more question or check one more source. First accounts are rarely the whole picture.' },
  { id: 'no-drumhead', fit: 'any', styles: ['mediator', 'servant'], source: TNG('The Drumhead'), title: 'Look for the cause, not a culprit',
    how: 'When something goes wrong, ask what in the process let it happen before asking who did it. Fear of blame hides the next problem.' }
];
const BY_ID = Object.fromEntries(PRACTICES.map(p => [p.id, p]));

// One practice per local day (practice_log, migration 16); "Another" swaps it. The day picks from
// what fits, avoiding ones from the last three weeks.
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Today's conversations with your people (including ones already over). */
function todaysConversations(ymd) {
  try {
    return agenda({ days: 1, from: startOfLocalDay(ymd) })
      .filter(e => e.people.length && e.status !== 'skipped' && !e.all_day && local(new Date(e.start)).ymd === ymd);
  } catch { return []; }
}

function choose(ymd, swaps, convs, exclude = []) {
  const recent = new Set(db.prepare('SELECT practice_id FROM practice_log WHERE day >= ? AND day < ?').all(addDays(ymd, -21), ymd).map(r => r.practice_id));
  const busy = convs.length >= 4;
  // Your leadership styles (Settings → About you) make matching practices about twice as likely.
  const styles = chosenStyles(getSettings().profile);
  const base = p => p.fit === 'talk' ? (convs.length ? 3 : 0) : p.fit === 'busy' ? (busy ? 3 : 1) : 2;
  const weight = p => base(p) && (styles.length && (p.styles || []).some(x => styles.includes(x)) ? base(p) * 2 + 1 : base(p));
  let pool = PRACTICES.filter(p => weight(p) && !recent.has(p.id) && !exclude.includes(p.id));
  if (!pool.length) pool = PRACTICES.filter(p => weight(p) && !exclude.includes(p.id));
  const tickets = pool.flatMap(p => Array(weight(p)).fill(p));
  return tickets[hash(`${ymd}:${swaps}`) % tickets.length];
}

/** Where to try it today: the next conversation (or the most recent one), for "talk" practices. */
function contextFor(p, convs) {
  if (p.fit !== 'talk' || !convs.length) return null;
  const ev = convs.find(e => Date.parse(e.start) > Date.now() - 15 * 60e3) || convs.at(-1);
  return { event_title: ev.title, start: ev.start, people: ev.people.map(x => ({ id: x.id, name: x.name })) };
}

const shape = (row, convs) => {
  const p = BY_ID[row.practice_id] || PRACTICES[0];
  const profile = getSettings().profile;
  const mine = chosenStyles(profile);
  const fits = (p.styles || []).filter(x => mine.includes(x)).map(x => STYLES[x].label);
  const q = quoteForDay(row.day, profile);
  return { day: row.day, id: p.id, title: p.title, how: p.how, source: p.source, fits, done_at: row.done_at || null, try_in: contextFor(p, convs),
    quote: q && { text: q.text, who: q.who, work: q.work, url: q.url || null } };
};

/** Today's practice (picked on first look today). */
export function todaysPractice() {
  const ymd = local().ymd;
  const convs = todaysConversations(ymd);
  let row = db.prepare('SELECT * FROM practice_log WHERE day = ?').get(ymd);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO practice_log(day, practice_id, created_at) VALUES (?, ?, ?)').run(ymd, choose(ymd, 0, convs).id, now());
    row = db.prepare('SELECT * FROM practice_log WHERE day = ?').get(ymd);
  }
  return shape(row, convs);
}

/** "Another": a different practice for today. */
export function swapPractice() {
  const cur = todaysPractice();
  const ymd = cur.day;
  const row = db.prepare('SELECT * FROM practice_log WHERE day = ?').get(ymd);
  const convs = todaysConversations(ymd);
  const next = choose(ymd, row.swaps + 1, convs, [cur.id]);
  db.prepare('UPDATE practice_log SET practice_id = ?, swaps = swaps + 1, done_at = NULL WHERE day = ?').run(next.id, ymd);
  return todaysPractice();
}

/** "I tried it" (or undo). */
export function markPractice(done) {
  const cur = todaysPractice();
  db.prepare('UPDATE practice_log SET done_at = ? WHERE day = ?').run(done ? now() : null, cur.day);
  return todaysPractice();
}

/** Today's practice, if one was picked, for the end-of-day note. */
export function practiceForDay(ymd = local().ymd) {
  const row = db.prepare('SELECT * FROM practice_log WHERE day = ?').get(ymd);
  return row ? { ...BY_ID[row.practice_id], done_at: row.done_at } : null;
}
