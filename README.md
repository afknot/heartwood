# Heartwood

**A private leadership journal for people managers, running on your own server.**

Record your 1:1s and voice memos, or just write. Heartwood turns them into notes, keeps track of what you promised, preps you for your next conversation and gives you honest coaching on how you're showing up as a leader. Everything lives on your server. Only the AI provider you pick sees text, and only when it's transcribing or reflecting.

*An [AFK Consulting](https://afk.consulting) tool. Free and open source under the [AGPL-3.0](#license).*

---

## Contents

- [What it does](#what-it-does)
- [Is it right for you?](#is-it-right-for-you)
- [Install](#install) (about 20 minutes)
- [Everyday use](#everyday-use)
- [Privacy and security](#privacy-and-security)
- [Backups and restoring](#backups-and-restoring)
- [Updates](#updates)
- [Meeting invites](#meeting-invites)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## What it does

**Capture**
- **Record** 1:1s, meetings and voice memos from your phone or computer. Every recording starts with a consent check. Audio is saved to your device every few seconds while you record, so a dropped connection, a closed app or the phone suspending Heartwood never loses what was said: Heartwood saves what was recorded and offers to continue as part 2. Pick and test your microphone first, get a warning if it isn't hearing anything, and on desktop you can also record a web meeting's sound from its browser tab.
- **Write** in a calm editor that saves as Markdown.
- **Add notes from files**: Word docs, PDFs, slides, spreadsheets, or photos of handwritten notes and sticky notes. Heartwood reads them and writes the note. A long running log (like years of 1:1 notes) can be split into one note per meeting.
- **Transcribe** privately on your server with Whisper, or with OpenAI or Gemini.

**Reflect**
- **Reflect** on any note: a summary, follow-ups, what you may have missed, coaching ideas for each person, and feedback on how you showed up.
- **End-of-day reflection**: a short guided note on weekdays.
- **Something to try**: one small way to show up each day, from 66 practices like inviting "I intend to…", hearing each side of a tension separately, or asking "And what else?". It's picked to fit your day (a listening practice when you have 1:1s, a pause when you're back-to-back) and your leadership style. The top of Today shows one thing at a time, chosen for the moment: the practice while it can still help today, otherwise a good moment from your own journal (a note you've since worked through, praise you received, a win on your team worth recognizing) or a short quote. "Something else" shows the others.
- **Your leadership style**: in Settings → About you, choose up to three kinds of leader you want to be: servant leader, gives space, bridge-builder, coach, empathetic, candid and caring, or sets direction. Coaching, prep, debriefs, 1:1 agendas and the daily practice all lean toward them.
- **Debriefs** each week or month: themes, blind spots and how your leadership is trending.
- **Ask about this**, right where you are: every person, note and meeting has an Ask bar already scoped to it, and the chats stay with it. The Ask button at the top of each screen asks your whole journal. Answers link back to the notes they used.
- **Write a message** to someone from their page, a note or a meeting: draft from rough notes or your voice, improve your own draft (with what changed and why), or reply to theirs. You get two versions in your voice, checked for private details that shouldn't go out. Heartwood never sends anything: copy it or open it in Mail.
- **Your voice**: seven short writing exercises across situations and audiences (praise, hard feedback, saying no to a peer, bad news to your manager, and more), plus messages you've sent. Heartwood describes how you write and how you shift by audience, and gets closer every time you edit a draft before using it.
- **Context, not clutter**: updates and clarifications live with the person, note or meeting they're about, not in your journal. Ask, prep and drafted messages use them.

**Your team**
- **Your week**: five rings for the work week. Monday is the heartwood dot at the center and Tuesday to Friday are the rings around it, so the week's shape is there from Monday morning and fills in as you go. Conversations, notes, reflections, closed follow-ups, kudos and practices make a day's mark thicker; a quiet day is a fine line, never a gap. Past weeks are a tap away, each as its own five rings. Below it, **your team this week**: each direct report's face fills in once you've talked, with how they seemed to you (Good, Okay or Carrying something, one tap after a conversation, private to you). People you meet every two weeks aren't shown as missed in their off week. Anyone who might need you gets a small dot and a reason from your own notes (you've marked them Carrying something twice, you owe them something overdue, it's been longer than usual, or they had a win you haven't recognized), with a next step. Each person's page shows how they've seemed over the last 8 weeks.
- **Today** shows what's coming up, with one-tap prep for each conversation, and your top three follow-ups (the rest are a tap away, and older ones that aren't pressing wait in Someday). Let a follow-up go on purpose ("decided not to", "no longer needed") and it counts as handled. "Say hi to" suggests up to three people you haven't talked to lately, with a reason to reach out.
- **1:1 agenda builder**: pick a regular 1:1, quick check-in, first 1:1, career conversation, feedback conversation or working through a tension. Heartwood lays out a structure (their topics first), brings in open follow-ups, adds questions for your leadership style and suggests topics from your notes. Mark anything "Just you", copy the rest to send ahead, and start your notes from it.
- **People**: a page for each person with notes, a relationship brief before your 1:1, pronouns, their local time, open follow-ups, and a growth record (goals, wins, feedback you gave, concerns, a review draft to start from). You can also give kudos from that page: a line to say in your next 1:1 (it lands on the agenda and in prep), a message to them you can send on Slack or open in Teams, a team-channel shout-out you can post to Slack or a Teams channel, and a LinkedIn post and recommendation. Nothing is sent until you tap Send and confirm; Slack goes out as you with your own user token (Settings → Slack & Teams), and a Teams channel post uses that channel's Workflows webhook.
- **Recurring meetings** you set up, or meetings pulled from invites you forward to Heartwood's own email address.

**Your career**
- **Career record**: Heartwood finds evidence of your own work in your notes (initiatives you led and their outcomes, how you lead, big decisions, feedback you received) and suggests items to keep. From those it drafts portfolio stories, resume updates and LinkedIn posts. Names are swapped for roles, and drafts only reach your portfolio as pull requests you approve.

**Around it**
- **Phone notifications**: a morning summary, a heads-up before conversations, a "How did it go?" nudge afterwards, and the weekly debrief.
- One voice input everywhere, in the same style as recording: Ask, messages, updates, context and exercises.
- Five tabs: **Today**, **Journal**, **Record**, **Team** and **You** (your leadership style, voice, debriefs, career record, chats and Settings).
- Install it to your phone's home screen. Sign in with Face ID, Touch ID or a passkey.
- Choose **Claude, OpenAI or Gemini** for reflection, and change your mind any time.
- **Nightly encrypted backups** to Google Drive, set up and checked in Settings.
- **Updates install themselves**, and roll back if something goes wrong.
- **Export** everything as Markdown or JSON.

---

## Is it right for you?

Heartwood is a good fit if you:

- manage people and want a private place to think about it;
- are comfortable following a setup guide on a server. You run about four commands once; after that everything happens in Settings;
- are OK sending note text (never audio, if you use on-server transcription) to one AI provider you choose.

Things to know first:

- **One person per install.** Each manager runs their own copy. There are no shared accounts or team features.
- **You're the administrator.** It's your server and your data, so backups and keeping the server online are on you. Heartwood helps: it backs itself up, updates itself and tells you when something's wrong.
- **Check your workplace rules.** Notes about colleagues are sensitive. Some organizations don't allow work information in personal tools or AI services. That decision is yours.
- **Recording needs everyone's consent** in many places. Heartwood asks you to confirm before every recording. When in doubt, ask out loud at the start.

### What it costs

- **A server.** A small cloud server is about $6/month; a spare mini PC at home costs nothing. You'll need 2 GB of memory, or 4 GB for on-server transcription.
- **A web address**, like `heartwood.yourdomain.com`.
- **AI usage**, billed by the provider. Typical personal use costs a few dollars a month.

---

## Install

You need a Linux server (Ubuntu recommended) with [Docker](https://docs.docker.com/engine/install/ubuntu/), a web address, and an API key from [Anthropic](https://console.anthropic.com/), [Google AI Studio](https://aistudio.google.com/apikey) or [OpenAI](https://platform.openai.com/api-keys).

> **Why HTTPS matters:** phones only allow the microphone on `https://` sites. Heartwood gets free certificates from Let's Encrypt for you.

### 1. Point your web address at the server

In your domain's DNS settings, add an **A record** for the name you want (for example `heartwood`) pointing to the server's public IP address. On a home server, also forward ports **80** and **443** on your router to it.

### 2. Install

On the server:

```bash
git clone https://github.com/afknot/heartwood.git heartwood
cd heartwood
./deploy/install.sh
```

The installer asks three questions: a password, your web address and your time zone. Then it builds and starts everything: Heartwood, HTTPS, on-server transcription and the backup service. The first build takes a few minutes.

### 3. Turn on automatic updates

```bash
./deploy/connect-github.sh
```

From then on your server checks for updates every few minutes and installs them, rolling back if anything fails. See [Updates](#updates) to follow your own fork instead.

### 4. Finish in Settings

Open your web address, sign in, and go to **You → ⚙ Settings**:

1. **AI & transcription → API keys**: paste a key and tap **Test**.
2. **About you**: your role, team and goals. This is what makes the coaching specific to you.
3. **Your data & backups**: tap **Turn on encrypted backups**, then **Connect Google Drive**.
4. **Sign-in & security**: add a passkey.
5. Optional: **Meetings & calendar**, **Notifications**, **Career export**.

Then add it to your phone:

- **iPhone:** open it in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap ⋮, then **Install app**.

Finally, add your direct reports under **People**.

<details>
<summary>Already running Caddy, Nginx or another web server on ports 80/443?</summary>

The installer notices and skips its own HTTPS. Point your proxy at `127.0.0.1:3410`. For Caddy, `./deploy/add-to-caddy.sh` adds the site for you, and rolls back if Caddy rejects it.
</details>

---

## Everyday use

- **Record** (red button): choose the type, add who's in it, test your microphone, confirm consent, record. Keep Heartwood on screen while recording; phones stop the microphone when you switch apps, and Heartwood keeps everything recorded up to that point.
- **+** on the Journal: write a note, record, or add a note from files. Notes save as you type.
- **Reflect** on a note for coaching. **Add to note** turns follow-ups into a checklist.
- **People → someone → Generate** for a brief before your 1:1.
- **Today** for what's next, your top follow-ups and the end-of-day reflection.
- **Ask** to search and think across everything you've written.

### Which AI provider?

| | Reflection | Transcription | Where your data goes |
|---|---|---|---|
| **On-server Whisper** | | ✓ | Stays on your server |
| **Claude** | ✓ | | Anthropic |
| **OpenAI** | ✓ | ✓ | OpenAI |
| **Gemini** | ✓ | ✓ | Google |

A good default is Whisper for transcription and Claude for reflection: audio never leaves your server, and only text is sent for analysis. Gemini transcription adds speaker labels. Models can be changed in Settings. `WHISPER_MODEL` in `.env` sets the Whisper size: `base` is faster, `medium` more accurate.

To change how the coach talks to you, edit `server/src/prompts.js`. Leadership styles and quotes are in `server/src/leadership.js`, daily practices in `server/src/practices.js`, and 1:1 agenda structures in `server/src/oneonone.js`.

The practices and agenda structures are written for Heartwood, inspired by Robert K. Greenleaf, L. David Marquet, Amy Edmondson, Michael Bungay Stanier, Kim Scott, Brené Brown, Bob Chapman, Andy Grove, Lara Hogan, Marshall Rosenberg, Reed Hastings and Erin Meyer, Dale Carnegie, Thich Nhat Hanh, the crews of *Star Trek* and *The Next Generation*, the offices of *Parks and Recreation*, *The Office* and *30 Rock*, and favorite films from the '80s, '90s and 2000s. Quotes are kept short and attributed.

---

## Privacy and security

- **Your data stays in one folder.** Everything is in `./data` on your server: the database, audio, files and photos.
- **AI providers see only what they need.** Only the providers you choose receive content, and only when transcribing or reflecting. Turn on **Delete audio after transcribing** if you only want to keep text.
- **Keys and passwords are encrypted.** Those you enter in Settings are stored with AES-256-GCM. The encryption key stays on the server and isn't part of backups, so a copied backup doesn't expose them.
- **Sign-in is protected.**
  - One user, with a password and/or passkeys.
  - Sessions are stored only as hashes.
  - Wrong guesses are rate-limited: 5 wrong tries locks that address for 15 minutes.
- **The web app is locked down.**
  - Strict Content-Security-Policy, HSTS, no framing, and a same-site check on every change.
  - Uploaded files are never rendered as web pages.
  - Links you give it can't point at your home network.
- **The calendar link is protected.** It's stored only on the server and never shown again. Attendee email addresses stay on the server too.
- **It's kept out of search engines.** Heartwood tells them not to index it.
- **Updates are safe to install.** The app runs as an unprivileged user, and updates that fail to start are rolled back.

Found a security problem? Please [report it privately](https://github.com/afknot/heartwood/security/advisories/new) rather than opening a public issue.

---

## Backups and restoring

Turn backups on in **Settings → Your data & backups**:

1. Choose Google Drive (recommended) or this server only.
2. Choose a passphrase and keep it in your password manager. **Without it, the backups can't be opened.**
3. Tap **Connect Google Drive**, sign in and choose Allow. Google then opens a page that won't load; it starts with `http://127.0.0.1:53682/`. Copy that whole address and paste it back into Settings.

The first backup runs right away. After that:

- **When:** every night at 3:30am in your time zone.
- **What:** the database, audio, files and photos.
- **How many:** 7 daily, 5 weekly and 12 monthly copies.
- **Checked:** a sample is test-read every Sunday.

Everything is encrypted with [restic](https://restic.net) before it leaves your server. Heartwood can only see files it created in your Drive, which are in a folder called `Heartwood-backups`. You can't open them in Drive, and that's the point.

Settings shows when the last backup went through, with **Back up now**. If backups fail or stop for two days, Settings says why and your phone gets a heads-up.

<details>
<summary>Prefer Backblaze B2, S3 or SFTP?</summary>

Set `RESTIC_PASSWORD` and `RESTIC_REPOSITORY` in `.env`, for example `b2:bucket:heartwood`. See the [restic docs](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html) for the other formats. Settings wins if both are set.
</details>

**To restore**, run on the server:

```bash
cd ~/heartwood
docker compose --profile backup run --rm --entrypoint restic backup snapshots            # list backups
docker compose --profile backup run --rm --entrypoint restic backup restore latest --target /backups/restore
# then stop Heartwood, copy backups/restore/data/... back into data/, and start it again
```

After restoring onto a new server, re-enter your API keys and mailbox password in Settings. They're encrypted with a key that stays on the old server, on purpose.

**Settings → Export** gives you Markdown and JSON at any time.

---

## Updates

`./deploy/connect-github.sh` makes your server follow this repository. It installs new versions on its own a few minutes after they're published, and rolls back if one fails to start. **Settings → Updates** shows what's running and what's new, has an **Update now** button, and lets you turn automatic installs off so you choose when updates go in.

**Want to review changes before they reach you, or make your own?** Fork the repository and follow your fork instead:

```bash
./deploy/connect-github.sh your-name/heartwood
```

Private forks work too: the script makes a read-only deploy key and tells you where to add it.

The app never runs commands itself. It leaves a request in `data/` that the server's updater picks up. The update log is in `~/heartwood-update.log`.

**Manual updates:** `git pull && ./deploy/install.sh`. The database upgrades itself; your data stays in `./data`.

---

## Meeting invites

Heartwood can have its own email address. Add it to a meeting, or forward a meeting to it, and the meeting shows up on Today with prep, including new times and cancellations. It never replies or RSVPs.

1. Create a mailbox with your email host, like `heartwood@yourdomain.com`. It works with any mailbox that allows IMAP with a password, such as cPanel hosting, Fastmail, or Gmail with an app password. Microsoft 365 and Outlook.com mailboxes aren't supported for this.
2. In **Settings → Meetings & calendar**, enter the address and password and tap **Save and check**.
3. Add your work address under **Allowed senders**, or `@yourworkdomain` for your whole organization.

Good to know:

- **Only allowed senders are read.** Mail that fails sender checks is ignored, and Settings shows anything it skipped, with a one-tap **Allow**.
- **It keeps only the basics.** Heartwood keeps the title, time, location and attendees. Descriptions, join links and attachments are dropped, and emails are deleted from the mailbox after a week.
- **Everyone on an invite can see Heartwood's address.** Your organization's rules on sharing meeting details still apply.

You can also set up recurring 1:1s by hand under **Recurring**, or link a calendar feed.

---

## Troubleshooting

| Problem | Try |
|---|---|
| Something isn't working | `docker compose logs heartwood` on the server |
| Forgot your password | `docker compose exec heartwood node src/reset-password.js`, then sign in with `APP_PASSWORD` from `.env` and set a new one in Settings |
| Microphone doesn't work | Make sure you're on the `https://` address. On iPhone, open Heartwood from its home screen icon |
| No notifications on iPhone | Open Heartwood from its home screen icon, then turn them on in Settings → Notifications |
| Backups failing | Settings → Your data & backups says why. "Reconnect Google Drive" fixes most cases |
| An update failed | Settings → Updates shows the log. The previous version keeps running |

Questions and bug reports: [open an issue](https://github.com/afknot/heartwood/issues). Please don't paste journal content or keys into issues.

---

## Development

```bash
# terminal 1
cd server && npm install
APP_PASSWORD=dev COOKIE_SECURE=false DATA_DIR=../data npm run dev

# terminal 2
cd web && npm install && npm run dev
```

Open the Vite address on your computer. `localhost` counts as secure, so the microphone works there.

```
server/src/
  index.js        Express app, sign-in, static files
  db.js           SQLite schema and migrations, full-text search, settings
  llm.js          Claude / OpenAI / Gemini behind one function
  transcribe.js   Audio chunking and transcription
  prompts.js      Every coaching prompt: tune the voice here
  jobs.js         Transcribe → reflect → organize pipeline
  routes/         API routes
web/src/
  pages/          Today, Journal, Entry, Record, People, Ask, Settings…
  components/     Editor, reflection panel, pickers, sheets
deploy/           Installer, updater, backup service, HTTPS helpers
```

Contributions are welcome. Please open an issue first for anything large.

---

## License

Heartwood is free software under the [GNU Affero General Public License v3.0](LICENSE).

In short:
- **You can** use it, change it and share it, including at work.
- **If you share a changed version, or let other people use one over a network,** you must make your source code available to them under the same license. If you do, update the **Source code** link on the sign-in page (`web/src/pages/Login.jsx`) to point at your version.

Heartwood comes with no warranty. It isn't a substitute for your organization's HR, legal or employee-relations advice.

Copyright © 2026 AFK Consulting.
