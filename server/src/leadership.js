// Leadership styles you can choose in Settings → About you ("the kind of leader I want to be").
// They shape the coaching voice, which practices Today suggests, the quote of the day and the
// questions in 1:1 agendas. Descriptions are Heartwood's own summaries of each approach.

export const STYLES = {
  servant: {
    label: 'Servant leader',
    short: 'Serve first. Success is whether your people grow.',
    coach: 'They want to lead as a servant leader (Robert K. Greenleaf): listening first, removing obstacles, investing in each person\'s growth and building community. Measure their leadership by whether the people they serve grow. Watch for them rescuing people or absorbing work instead of growing others.'
  },
  space: {
    label: 'Gives space',
    short: 'Context, not control. Decisions sit with the people closest to the work.',
    coach: 'They want to give space rather than micromanage: set clear intent and context, push decisions to the people closest to the work, talk last, and let people bring "I intend to…" rather than asking permission. Gently flag moments of hovering, re-doing work, or deciding things others could decide, and suggest what context would let them step back. Space is not absence: they should stay available and clear on outcomes.'
  },
  mediator: {
    label: 'Bridge-builder',
    short: 'Repair rather than reprimand. Find the interests under the positions.',
    coach: 'They want to mediate rather than reprimand: understand each side separately first, look for the needs and interests underneath positions, describe behavior without judgment, help people agree on what happens next, and follow up. When they describe friction, coach them toward a conversation that repairs the working relationship, not a verdict. Still name it when a decision or a firm boundary is needed, and when something belongs with HR.'
  },
  coach: {
    label: 'Coach',
    short: 'Ask more than tell. Build people who can find the answer.',
    coach: 'They want to lead as a coach: stay curious a little longer, ask before advising ("And what else?", "What\'s the real challenge here for you?", "How can I help?"), and help people find their own answers. Point out moments they jumped to advice. Remind them that some moments need a clear answer instead.'
  },
  empathetic: {
    label: 'Empathetic',
    short: 'Lead with understanding. Make it safe to speak up.',
    coach: 'They want to lead with empathy: notice what people are carrying, acknowledge feelings before solving, and build psychological safety (admitting their own mistakes, inviting dissent, thanking people for bad news). Pair empathy with clarity: being vague to be nice is not kind. Watch for them taking on everyone\'s stress without boundaries.'
  },
  candid: {
    label: 'Candid and caring',
    short: 'Care personally, challenge directly, and ask for feedback first.',
    coach: 'They want to be candid and caring (Kim Scott\'s Radical Candor): give specific, timely feedback because they care, praise in public and raise criticism in private, and ask for feedback on themselves first. Flag feedback they held back, softened until unclear, or gave without care.'
  },
  visionary: {
    label: 'Sets direction',
    short: 'Connect the work to why it matters and where you\'re going.',
    coach: 'They want to set direction: make the purpose and the destination clear, connect each person\'s work to it, and leave room for people to choose how to get there. Notice when the team seems to lack the why, and when direction has turned into dictating the how.'
  }
};

/** Styles chosen in Settings, stored as "servant,space". */
export function chosenStyles(profile = {}) {
  return String(profile.leadership_styles || '').split(',').map(s => s.trim()).filter(s => STYLES[s]).slice(0, 3);
}

/** Coaching guidance for the prompts. */
export function styleGuidance(profile = {}) {
  const ids = chosenStyles(profile);
  if (!ids.length) return '';
  return `Leadership styles they're growing toward: ${ids.map(id => STYLES[id].label).join(', ')}.\n${ids.map(id => `- ${STYLES[id].coach}`).join('\n')}\nTailor your coaching to these styles: notice and name moments they lived them, and when something they describe pulls the other way, offer the version that fits, without judging them.`;
}

// Short quotes, checked against the linked source. Kept brief and attributed.
export const QUOTES = [
  { text: 'Do those served grow as persons?', who: 'Robert K. Greenleaf', work: 'The Servant as Leader', styles: ['servant'], url: 'https://serveleadnow.com/greenleafs-best-test-servant-leader/' },
  { text: 'Push authority to information, not information to authority.', who: 'L. David Marquet', work: 'on intent-based leadership', styles: ['space'], url: 'https://nextbigideaclub.com/magazine/conversation-a-navy-captain-on-why-the-best-leaders-dont-have-all-the-answers/22777/' },
  { text: 'Lead with context, not control.', who: 'Netflix culture', work: 'No Rules Rules', styles: ['space', 'visionary'], url: 'https://www.leadingsapiens.com/netflix-leads-with-context-not-control/' },
  { text: 'Psychological safety is “a shared belief that the team is safe for interpersonal risk-taking.”', who: 'Amy Edmondson', work: 'The Fearless Organization', styles: ['empathetic', 'coach'], url: 'https://umbrex.com/resources/frameworks/organization-frameworks/psychological-safety-framework-edmondson/' },
  { text: 'Clear is kind. Unclear is unkind.', who: 'Brené Brown', work: 'Dare to Lead', styles: ['candid', 'empathetic'], url: 'https://brenebrown.com/blog/2018/10/15/clear-is-kind-unclear-is-unkind' },
  { text: 'Radical Candor is caring personally and challenging directly at the same time.', who: 'Kim Scott', work: 'Radical Candor', styles: ['candid'], url: 'https://gsb.stanford.edu/insights/radical-candor-communication-shift-can-transform-your-career' },
  { text: 'Listening isn’t doing nothing; it’s doing something.', who: 'Bob Chapman', work: 'Everybody Matters', styles: ['servant', 'empathetic', 'mediator'], url: 'https://positiveorgs.bus.umich.edu/news/bob-chapman-named-incs-3-ceo-in-the-world-reflects-on-the-need-for-caring-leaders/' },
  { text: 'Our people are our product.', who: 'Bob Chapman', work: 'Everybody Matters', styles: ['servant'], url: 'https://positiveorgs.bus.umich.edu/news/bob-chapman-named-incs-3-ceo-in-the-world-reflects-on-the-need-for-caring-leaders/' },
  { text: 'And what else?', who: 'Michael Bungay Stanier', work: 'The Coaching Habit', styles: ['coach'], url: 'https://news.stthomas.edu/seven-questions-that-will-change-the-way-you-lead' },
  { text: 'What’s the real challenge here for you?', who: 'Michael Bungay Stanier', work: 'The Coaching Habit', styles: ['coach', 'mediator'], url: 'https://news.stthomas.edu/seven-questions-that-will-change-the-way-you-lead' },
  { text: 'It should be regarded as the subordinate’s meeting, with its agenda and tone set by him.', who: 'Andy Grove', work: 'High Output Management, on one-on-ones', styles: ['servant', 'space', 'coach'], url: 'https://getlighthouse.com/blog/high-output-management' },
  { text: 'Only a true natural servant automatically responds to any problem by listening first.', who: 'Robert K. Greenleaf', work: 'The Servant as Leader (1970)', styles: ['servant', 'mediator'], url: '' },
  // Star Trek: single lines, attributed to the character and episode.
  { text: 'It is possible to commit no mistakes and still lose. That is not a weakness; that is life.', who: 'Captain Picard', work: 'Star Trek: The Next Generation, “Peak Performance”', styles: ['coach', 'empathetic'], url: 'https://comicbook.com/tv-shows/list/the-10-best-picard-quotes-from-star-trek-the-next-generation/' },
  { text: 'There are times, sir, when men of good conscience cannot blindly follow orders.', who: 'Captain Picard', work: 'Star Trek: The Next Generation, “The Offspring”', styles: ['servant', 'candid'], url: 'https://comicbook.com/tv-shows/list/the-10-best-picard-quotes-from-star-trek-the-next-generation/' },
  { text: 'The first duty of every Starfleet officer is to the truth.', who: 'Captain Picard', work: 'Star Trek: The Next Generation, “The First Duty”', styles: ['candid'], url: 'https://comicbook.com/tv-shows/list/the-10-best-picard-quotes-from-star-trek-the-next-generation/' },
  { text: 'Live now; make now always the most precious time. Now will never come again.', who: 'Captain Picard', work: 'Star Trek: The Next Generation, “The Inner Light”', styles: ['empathetic'], url: 'https://comicbook.com/tv-shows/list/the-10-best-picard-quotes-from-star-trek-the-next-generation/' },
  { text: 'Risk is our business.', who: 'Captain Kirk', work: 'Star Trek, “Return to Tomorrow”', styles: ['visionary', 'space'], url: 'https://www.startrek.com/news/captain-kirks-wisest-quotes' },
  { text: 'Leave any bigotry in your quarters, there’s no room for it on the bridge.', who: 'Captain Kirk', work: 'Star Trek, “Balance of Terror”', styles: ['candid', 'servant'], url: 'https://www.startrek.com/news/captain-kirks-wisest-quotes' },
  { text: 'Insufficient facts always invite danger.', who: 'Mr. Spock', work: 'Star Trek, “Space Seed”', styles: ['mediator', 'coach'], url: 'https://www.consultclarity.org/post/star-trek-leadership-quotes' },
  { text: 'Things are only impossible until they’re not.', who: 'Captain Picard', work: 'Star Trek: The Next Generation, “When the Bough Breaks”', styles: ['visionary'], url: 'https://www.techrepublic.com/article/20-star-trek-quotes-to-help-you-boldly-go-through-the-workday/' },
  { text: 'There’s no such thing as the unknown, only things temporarily hidden, temporarily not understood.', who: 'Captain Kirk', work: 'Star Trek', styles: ['visionary', 'coach'], url: 'https://www.startrek.com/news/leadership-from-the-ready-room' },
  { text: 'Change is the essential process of all existence.', who: 'Mr. Spock', work: 'Star Trek, “Let That Be Your Last Battlefield”', styles: ['visionary'], url: 'https://www.techrepublic.com/article/20-star-trek-quotes-to-help-you-boldly-go-through-the-workday/' },
  { text: 'May we together become greater than the sum of both of us.', who: 'Surak', work: 'Star Trek, “The Savage Curtain”', styles: ['mediator'], url: 'https://www.techrepublic.com/article/20-star-trek-quotes-to-help-you-boldly-go-through-the-workday/' },
  { text: 'Never half-ass two things. Whole-ass one thing.', who: 'Ron Swanson', work: 'Parks and Recreation, “Sweet Sixteen”', styles: ['space', 'coach'], url: 'https://en.wikiquote.org/wiki/Parks_and_Recreation' },
  { text: 'Yes, we are a team, but I am the team leader.', who: 'Leslie Knope', work: 'Parks and Recreation, “The Camel” (with a wink)', styles: ['visionary'], url: 'https://en.wikiquote.org/wiki/Parks_and_Recreation' },
  { text: 'Would I rather be feared or loved? Easy. Both.', who: 'Michael Scott', work: 'The Office (a cautionary tale)', styles: ['empathetic', 'candid'], url: 'https://pastemagazine.com/articles/2019/06/the-21-best-michael-scott-quotes.html' },
  { text: 'Whatever you do, don’t speak first.', who: 'Jack Donaghy', work: '30 Rock, “Today You Are a Man”, on negotiating', styles: ['mediator'], url: 'https://en.wikiquote.org/wiki/30_Rock' },
  { text: 'Whenever I have a problem, I tackle it head on.', who: 'Jack Donaghy', work: '30 Rock, “Jack Meets Dennis”', styles: ['candid'], url: 'https://en.wikiquote.org/wiki/30_Rock' },
  { text: 'Your scientists were so preoccupied with whether or not they could that they didn’t stop to think if they should.', who: 'Ian Malcolm', work: 'Jurassic Park (1993)', styles: ['candid', 'visionary'], url: 'https://www.fandom.com/articles/jeff-goldblums-greatest-jurassic-park-quotes' },
  { text: 'Life finds a way.', who: 'Ian Malcolm', work: 'Jurassic Park (1993)', styles: ['space'], url: 'https://www.fandom.com/articles/jeff-goldblums-greatest-jurassic-park-quotes' },
  { text: 'Let’s work the problem, people.', who: 'Gene Kranz', work: 'Apollo 13 (1995)', styles: ['coach', 'mediator'], url: 'https://en.wikiquote.org/wiki/Apollo_13_(film)' },
  { text: 'With all due respect, sir, I believe this is gonna be our finest hour.', who: 'Gene Kranz', work: 'Apollo 13 (1995)', styles: ['visionary'], url: 'https://en.wikiquote.org/wiki/Apollo_13_(film)' },
  { text: 'Great moments are born from great opportunity.', who: 'Herb Brooks', work: 'Miracle (2004)', styles: ['visionary', 'coach'], url: 'https://en.wikiquote.org/wiki/Miracle_(film)' },
  { text: 'I’m not looking for the best players. I’m looking for the right ones.', who: 'Herb Brooks', work: 'Miracle (2004)', styles: ['visionary', 'servant'], url: 'https://en.wikiquote.org/wiki/Miracle_(film)' },
  { text: 'The name on the front is a hell of a lot more important than the one on the back.', who: 'Herb Brooks', work: 'Miracle (2004)', styles: ['servant'], url: 'https://en.wikiquote.org/wiki/Miracle_(film)' },
  { text: 'Attitude reflects leadership, Captain.', who: 'Julius Campbell', work: 'Remember the Titans (2000)', styles: ['candid'], url: 'https://alearningaday.blog/2023/02/06/attitude-reflect-leadership/' },
  { text: 'It’s supposed to be hard. If it wasn’t hard, everyone would do it. The hard is what makes it great.', who: 'Jimmy Dugan', work: 'A League of Their Own (1992)', styles: ['coach', 'candid'], url: 'https://nofilmschool.com/crying-in-baseball' },
  { text: 'All we have to decide is what to do with the time that is given us.', who: 'Gandalf', work: 'The Lord of the Rings: The Fellowship of the Ring (2001)', styles: ['space', 'empathetic'], url: 'https://www.looper.com/786702/most-memorable-gandalf-quotes-of-all-time' },
  { text: 'Life moves pretty fast. If you don’t stop and look around once in a while, you could miss it.', who: 'Ferris Bueller', work: 'Ferris Bueller’s Day Off (1986)', styles: ['empathetic'], url: 'https://www.acmi.net.au/stories-and-ideas/ferris-buellers-day-off-life-moves-pretty-fast/' },
  { text: 'Carpe diem. Seize the day, boys. Make your lives extraordinary.', who: 'John Keating', work: 'Dead Poets Society (1989)', styles: ['visionary', 'coach'], url: 'https://en.wikipedia.org/wiki/AFI%27s_100_Years...100_Movie_Quotes' },
  { text: 'Do. Or do not. There is no try.', who: 'Yoda', work: 'The Empire Strikes Back (1980)', styles: ['coach'], url: 'https://starwars.com/news/empire-at-40-teaching-with-star-wars-the-wisdom-of-do-or-do-not' }
];

const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** One quote for the day, from your styles when you've chosen some. */
export function quoteForDay(ymd, profile = {}) {
  const ids = chosenStyles(profile);
  const pool = ids.length ? QUOTES.filter(q => q.styles.some(s => ids.includes(s))) : QUOTES;
  return (pool.length ? pool : QUOTES)[hash(`q:${ymd}`) % (pool.length || QUOTES.length)];
}
