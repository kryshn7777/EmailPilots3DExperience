/**
 * Every word the site says, sourced from FEATURES.md (2026-08-08 audit) and the live site's own copy.
 * Hard rules (FEATURES.md Appendix A/B, scene direction v2 §0):
 *  - none of the Appendix B banned phrases may appear anywhere in this file
 *    (verification greps for them — do not even quote them in comments)
 *  - "spam" only for the folder / filter checks
 *  - no price, no plan or tier names, no trial, no license keys, no "upgrade"; no Buy button; no dark-mode claims
 *  - no inbox-placement promise of any kind (no tool can promise placement), no bounce-rate stat
 *  - opens are not tracked, by design: success is counted in replies
 *  - the campaign the flight shows (names, clock times, "0 bounces") is the site's own hero mock-up, so on
 *    screen it is always labelled SAMPLE CAMPAIGN (story/fleet.ts holds it: names come from there)
 *  - AI reply-labels framed for Gmail/app-password inboxes, never "every account"
 *  - the AI "suggests fixes" — it never "rewrites before sending"
 *  - unsubscribe machinery is claimed only for Bulk mode
 *  - the installer link lives in ONE place: `DOWNLOAD.cta.href`
 */
import { CAMPAIGN, FLEET, OFFICE_ROW } from './fleet';

// ---- the flight's titles --------------------------------------------------------------------------

export interface PinnedTitle {
  /** the spot it stands at (webgl/actors/PinnedTitles.ts SPOTS) and, but for `ocean`, the chapter it titles */
  id: string;
  /** the small line over the lockup: it names the product feature the chapter shows */
  kicker: string;
  /** heavy / thin / heavy, four words or so in all (drawn in capitals) */
  lines: [string, string, string];
  /** under the lockup, in the beam colour: at most twelve words, at most two lines */
  sub?: string;
  /** a big claim in place of the sub (pre-flight only), with the Outlook mark beside it */
  note?: string;
  logo?: 'outlook';
  /** the feature in a few words: the progress rail's tick labels and the flight HUD */
  feature: string;
}

/**
 * The titles pinned into the world (webgl/actors/PinnedTitles.ts), in flight order. Read in order they are
 * the whole pitch: from your own inbox → ready for takeoff → one by one → follow-ups that stop themselves →
 * don't BCC 100 people → never a flood → cleared for delivery → never the wrong person → a note, not a
 * broadcast → never phones home → the reply is the landing. Title windows: direction §4.3 (SPOTS).
 */
export const PINNED_TITLES: PinnedTitle[] = [
  {
    id: 'desk', kicker: 'Email Pilots · AI-powered outreach', feature: 'Your own inbox',
    lines: ['From', 'your own', 'inbox'], sub: 'Write one email. Everyone gets their own.',
  },
  {
    id: 'preflight', kicker: 'CH 02 · Pre-flight check', feature: 'Pre-flight check',
    lines: ['Ready', 'for', 'takeoff'], note: 'Works with Gmail · Outlook · any email', logo: 'outlook',
  },
  {
    id: 'takeoff', kicker: 'CH 03 · Human pacing', feature: 'Human pacing',
    lines: ['One', 'by', 'one'], sub: 'Minutes apart, never all at once, like you’d send them by hand.',
  },
  {
    id: 'formation', kicker: 'CH 04 · Sequences', feature: 'Sequences',
    lines: ['Follow-ups', 'that stop', 'themselves'], sub: 'Someone replies? Their next emails stand down. Automatically.',
  },
  {
    id: 'storm', kicker: 'CH 05 · The storm · Spam filters', feature: 'Spam-filter check',
    lines: ['Don’t BCC', '100', 'people'], sub: 'One email to a hundred is a one-way ticket to the spam folder.',
  },
  {
    // over the open sea on the way in to the lighthouse, before the tower is out of the fog (no chapter of its own)
    id: 'ocean', kicker: 'CH 06 · Open water · Safe limits', feature: 'Safe limits',
    lines: ['Never', 'a', 'flood'], sub: 'About 50 a day per mailbox. New mailboxes warm up from 5.',
  },
  {
    id: 'beacon', kicker: 'CH 06 · The beacon · Domain check', feature: 'Domain check',
    lines: ['Cleared', 'for', 'delivery'], sub: 'SPF, DKIM and DMARC checked, with the exact fix if not.',
  },
  {
    id: 'no-fly', kicker: 'CH 07 · Do-not-send list', feature: 'Do-not-send list',
    lines: ['Never', 'the wrong', 'person'], sub: 'Bounced or unsubscribed? No mailbox will email them again.',
  },
  {
    id: 'city', kicker: 'CH 08 · City of inboxes', feature: 'City of inboxes',
    lines: ['A note,', 'not a', 'broadcast'], sub: 'From your own address, it lands like you typed it yourself.',
  },
  {
    id: 'copilot', kicker: 'CH 09 · Local AI copilot', feature: 'Local AI copilot',
    lines: ['Never', 'phones', 'home'], sub: 'The AI runs on your PC. Zero data leaves it. Full stop.',
  },
  {
    id: 'landing', kicker: 'CH 10 · The last mile', feature: 'The last mile',
    lines: ['The reply', 'is the', 'landing'], sub: 'They write back. You step in for the conversations that matter.',
  },
];

export interface ChapterCopy {
  id: string;
  kicker: string;
  /** the lockup's three lines as a sentence */
  title: string;
  sub: string;
  feature: string;
}

/**
 * The ten chapters of the scroll stage (Experience.astro), generated from the pinned titles so the page's
 * hidden copy and the words in the flight are one source. The ocean title stands inside the storm-to-beacon
 * stretch and has no section of its own.
 */
export const HOME_CHAPTERS: ChapterCopy[] = PINNED_TITLES.filter((p) => p.id !== 'ocean').map((p) => ({
  id: p.id,
  kicker: p.kicker,
  title: `${p.lines.join(' ').replace(/\s+/g, ' ').replace(/,$/, '')}.`.replace(/^./, (c) => c.toUpperCase()),
  sub: p.sub ?? p.note ?? '',
  feature: p.feature,
}));

/** the rail's ticks and the flight HUD, one per chapter (page.ts reads them off the page) */
export const CHAPTER_NAMES = HOME_CHAPTERS.map((c) => c.feature.toUpperCase());

// ---- the words in the 3D scene ------------------------------------------------------------------

/**
 * The desk laptop (webgl/actors/LaptopScreen.ts): the app's composer, the site's own mock. `{{Name}}` spins
 * like a slot machine and lands on each of the three that leave the screen (fleet.ts DESK_NAMES); the other
 * fields resolve with it. `companies` are the site mock's own sample values, one per desk name.
 */
export const DESK_SCREEN = {
  app: 'EMAIL PILOTS',
  campaign: `Campaign: ${CAMPAIGN.name}`,
  recipients: `${CAMPAIGN.total} recipients`,
  label: CAMPAIGN.label,
  /** `{{Field}}` marks a merge field: it glows teal until it resolves */
  subject: 'Subject: Quick idea for {{Company}}',
  greeting: { before: 'Hi ', token: '{{Name}}', after: ',' },
  body: ['I came across {{Company}}', 'and wanted to reach out', 'personally about…'],
  attachment: 'Deck_{{Co}}.pdf',
  attachmentNote: '· for each recipient',
  companies: ['Acme', 'TechFlow', 'Globex'],
  queueTitle: 'Live queue',
  /** the foot while it resolves */
  merging: 'Personalising…',
  /** the foot once one has gone */
  sent: (name: string): string => `→ ${name} · sent from your own inbox`,
};

/** the names in the queue behind the three on the desk, in delivery order (#3 to #41): the envelope tunnel */
export const QUEUE_NAMES = FLEET.slice(2, FLEET.length - 1).map((r) => r.name);

/**
 * The pre-flight board (webgl/actors/Panel.ts, CanvasTextures.panelTexture): an airport departures board
 * whose rows flip like a split-flap display, and whose verdict flips from the app's real "Grounded" to
 * "Ready for takeoff" as the dart passes it (FEATURES.md §7: a verdict with a jump-to-fix next to every
 * blocker).
 */
export const PREFLIGHT_BOARD = {
  title: 'PRE-FLIGHT CHECK',
  flight: `${CAMPAIGN.name.toUpperCase()} · ${CAMPAIGN.total}`,
  grounded: 'GROUNDED',
  ready: 'READY FOR TAKEOFF',
  /** the first row's value cycles through the mailboxes it works with */
  rows: [
    { label: 'INBOX CONNECTED', values: ['GMAIL', 'OUTLOOK', 'SMTP'] },
    { label: 'ACCOUNTS HEALTHY', values: ['OK'] },
    { label: 'SUBJECT WRITTEN', values: ['OK'] },
    { label: 'STYLE: PERSONAL', values: ['OK'] },
    { label: `TODAY 0/${CAMPAIGN.cap}`, values: ['OK'] },
  ],
  pending: 'CHECK',
} as const;

/** The lighthouse card (webgl/interact/DeliveryPopup.ts): a clearance, not a delivery. */
export const AUTH_CARD = {
  bar: 'AUTH CHECK // LIGHTHOUSE',
  live: 'LIVE',
  title: 'CLEARED FOR DELIVERY',
  rows: [
    ['SPF', 'PASS'],
    ['DKIM', 'PASS'],
    ['DMARC', 'ALIGNED'],
    ['VERDICT', 'CLEARED'],
  ],
  foot: [CAMPAIGN.from.split('@')[1]!.toUpperCase(), 'EXACT FIX IF NOT'],
} as const;

/** the banner the biplane tows through the storm (webgl/actors/Biplane.ts) */
export const BANNER = 'ONE BY ONE';

/**
 * The IT office (the crossing through the tower, webgl/actors/Office.ts): forty screens flicker red with the old
 * way on them, one laptop lit warm with a personal note drafted on this PC. Lena is fleet.ts OFFICE_ROW.
 * `bar`, `title` and `sub` are the office card's (the same HUD card as the lighthouse's; `.delivery__sub` in
 * global.css styles the sub line).
 */
export const DETOUR_COPY = {
  bar: 'IT OFFICE · DESK 07',
  title: `DELIVERED · ${OFFICE_ROW.name}`,
  sub: 'Personalised on this PC.',
  /** the card's log, if it shows one */
  rows: [
    ['TO', `${OFFICE_ROW.name.toUpperCase()} · ${OFFICE_ROW.role.split(',')[0]!.toUpperCase()}`],
    ['DRAFTED', 'ON THIS PC'],
    ['TO THE CLOUD', '0 BYTES'],
  ],
  /** every monitor flickers red with it for a moment, then dies */
  bcc: ['Dear all,', 'BCC: +231'],
  /** the one warm laptop (RoomTextures.arrivalScreens opts) */
  screen: {
    name: OFFICE_ROW.name,
    subject: 'Your team’s launch',
    snippet: `Hi ${OFFICE_ROW.name}, saw your team just shipped…`,
  },
  badge: '✨ drafted on this PC · 0 bytes to the cloud',
} as const;

// ---- after the flight -----------------------------------------------------------------------------

/** The whole website after the flight (Landing.astro): one block over the last frame. */
export const INTRO = {
  kicker: 'Email Pilots · Windows desktop app',
  title: 'AI-powered outreach, sent from your own inbox.',
  body: 'Personal emails, sent one by one at a human pace from your Gmail, Outlook or any SMTP. Follow-ups stop when they reply. The AI runs on your PC.',
  tags: ['Gmail · Outlook · any email', '100% local & private', 'Windows 10/11'],
  replay: 'Replay the flight',
};

/** The live site: the brand's home and its legal pages (the footer links them). */
export const SITE = {
  home: 'https://emailpilots.com/',
  label: 'emailpilots.com',
  terms: 'https://emailpilots.com/terms/',
  privacy: 'https://emailpilots.com/privacy/',
};

export interface ManualItem {
  title: string;
  body: string;
}

export interface ManualSection {
  id: string;
  system: string;
  title: string;
  items: ManualItem[];
}

/** The Flight Manual (/features, linked from the footer) — every FEATURES.md claim, §1–11 + §13. */
export const MANUAL: ManualSection[] = [
  {
    id: 'connect',
    system: 'SYS 01 · Connect',
    title: 'Connect any mailbox',
    items: [
      { title: 'Sign in with Microsoft — no password', body: 'Outlook, Hotmail, and Microsoft 365 connect through Microsoft’s own sign-in page in your system browser. Email Pilots never sees a password; mail is sent through Microsoft’s official API, and replies and bounces are read the same way.' },
      { title: 'Gmail and custom SMTP via app password', body: 'A two-slide animated guide walks you through creating an app password on Google’s or Microsoft’s real settings pages — and pasting it with spaces still works.' },
      { title: 'The app knows your provider', body: 'Type an address and the right server settings fill in automatically, checking the domain’s mail records when it isn’t obvious.' },
      { title: 'Verified before saved', body: 'Every account is test-authenticated before it’s added, and a one-click "send test email to myself" proves the whole pipeline end to end.' },
      { title: 'Up to 5 mailboxes', body: 'Extra accounts send in parallel, each with its own daily allowance and health indicator, with bulk enable / disable / test / remove and a fleet overview strip.' },
    ],
  },
  {
    id: 'compose',
    system: 'SYS 02 · Compose',
    title: 'Write once, personal every time',
    items: [
      { title: 'Templates with merge fields', body: 'Write {{name}} or {{company}} once; every contact gets their own values, with per-field fallbacks ({{ name | there }}) so a missing value never prints a blank.' },
      { title: 'Per-person subject and message', body: 'Any contact can override the defaults entirely.' },
      { title: 'Campaigns', body: 'Group contacts into named campaigns, each with its own subject and template — one app, several parallel efforts that never bleed into each other.' },
      { title: 'A real preview, not a guess', body: 'See any email exactly as the recipient will, in a mail-client-style preview with HTML and plain-text tabs. A clean plain-text version of every email is generated automatically.' },
      { title: 'Attachments that follow the person', body: 'A shared document for everyone, a per-person file (a tailored CV, a specific proposal), or both — with custom filenames.' },
    ],
  },
  {
    id: 'boarding',
    system: 'SYS 03 · Boarding',
    title: 'Bring your people in, in minutes',
    items: [
      { title: 'CSV import with column mapping', body: 'Headers are auto-detected, you confirm the mapping, and every extra column becomes a merge field you can use in your message. Duplicates and invalid addresses are skipped and counted, so you know exactly what landed.' },
      { title: 'A three-step wizard for one-offs', body: 'Who → What → When, with a live preview before you commit.' },
      { title: 'One person, two mailboxes', body: 'Duplicate a contact to send to them from a second account without the two copies interfering.' },
      { title: 'Spread the load', body: 'Distribute contacts across your accounts in one action.' },
    ],
  },
  {
    id: 'sequences',
    system: 'SYS 04 · Sequences',
    title: 'Follow-ups that stop themselves',
    items: [
      { title: 'Multi-step sequences', body: 'Build a first email plus follow-ups with a chosen wait between each step; assign a sequence to any contact and the app takes it from there.' },
      { title: 'Stops the moment they reply', body: 'Before every follow-up, Email Pilots checks whether the person has answered — any of your connected inboxes counts — and cancels the rest of the sequence if they have.' },
      { title: 'Vacation-proof (optional)', body: 'With the local AI enabled, an out-of-office auto-reply on a Gmail or app-password inbox can be told apart from a real answer, so a beach week doesn’t silently end your sequence.' },
      { title: 'Progress that survives anything', body: 'Each person’s place in a sequence is saved after every single email — a crash, restart, or edit to the sequence never re-sends a step or skips one.' },
    ],
  },
  {
    id: 'pacing',
    system: 'SYS 05 · Pacing',
    title: 'Send like a human, automatically',
    items: [
      { title: 'Weekly schedules per contact', body: 'Pick days and up to five times, each with a ±minutes wobble so nothing fires at a robotic 09:00:00 sharp.' },
      { title: 'Bulk scheduling with natural spread', body: 'Give a group a time window and each person gets their own random slot inside it.' },
      { title: 'Human pauses between emails', body: 'Consecutive sends are separated by a randomized gap of minutes, not milliseconds.' },
      { title: 'Built-in limits that protect your reputation', body: 'A daily cap per mailbox, smaller per-batch caps, and a maximum of 3 emails to the same person per day.' },
      { title: 'New mailboxes are eased in', body: 'A fresh account ramps from ~5 to ~50 emails a day over its first days instead of going full speed on day one — with a one-day override when you genuinely need it lifted.' },
      { title: 'Watch the limits work', body: 'A live Today’s Usage meter shows emails sent against today’s cap, where you are in the current batch, and where the warm-up ramp currently sits.' },
      { title: 'You hold the throttle', body: 'Pause or resume all sending with one switch, send to everyone now when you decide, and check for replies on demand.' },
      { title: 'You always know what’s next', body: 'The dashboard shows the next run and a 7-day plan of every upcoming send and follow-up.' },
    ],
  },
  {
    id: 'no-fly-list',
    system: 'SYS 06 · No-Fly List',
    title: 'Never email the wrong person twice',
    items: [
      { title: 'One do-not-send list across all mailboxes', body: 'Bounced, unsubscribed, complained, or blocked by you — once an address is on the list, no account will email it again.' },
      { title: 'Bounces handled for you', body: 'Hard bounces are detected both at send time and from the bounce messages that arrive later, and the address is retired automatically. Forged bounce messages are recognized and ignored.' },
      { title: 'No accidental double-sends', body: 'The scheduler won’t re-email someone you already emailed manually today, and re-running a send skips everyone who already received that exact email.' },
      { title: 'Block anyone in one click', body: 'A manual do-not-send entry takes effect everywhere, instantly — and can be undone just as easily.' },
    ],
  },
  {
    id: 'deliverability',
    system: 'SYS 07 · Deliverability',
    title: 'Built to protect your sender reputation',
    items: [
      { title: 'A pre-flight check before anything flies', body: 'A dashboard card audits your whole setup — inbox connected, accounts healthy, subject written, sending style chosen, schedules in place, today’s allowance — and gives a verdict: Ready for takeoff, or Grounded with a jump-to-fix button next to every blocker.' },
      { title: 'Deliverability check before you send', body: 'Subject, wording, links, and formatting are scored against common spam-filter triggers, with plain-language findings — in the preview of every email and in a dedicated Deliverability lab.' },
      { title: 'AI second opinion (optional)', body: 'The on-device AI reviews a draft and suggests concrete fixes — you decide what to apply.' },
      { title: 'Domain authentication, demystified', body: 'Email Pilots checks your domain’s SPF, DKIM, and DMARC records and hands you the exact DNS values to paste, with step-by-step instructions for common registrars. Personal Gmail/Outlook addresses are told, correctly, that there’s nothing to set up.' },
      { title: 'Mismatch warnings before they hurt you', body: 'If your Microsoft sign-in address doesn’t match the domain you’re sending as, the app warns you before receivers start junking your mail.' },
      { title: 'Personal vs. Bulk sending style', body: 'Personal mode makes every email look exactly like one you typed by hand. Bulk mode adds a legal footer, your mailing address, and one-click unsubscribe headers.' },
      { title: 'Bad addresses caught early', body: 'Recipient domains are checked for working mail servers — including domains that explicitly refuse all mail — before a send is wasted on them.' },
      { title: 'Errors in plain English', body: 'Connection problems are translated into what actually happened and what to do next — including steering Microsoft users to the modern sign-in when a password can no longer work.' },
    ],
  },
  {
    id: 'records',
    system: 'SYS 08 · Records',
    title: 'Know exactly what happened',
    items: [
      { title: 'A live Sent history', body: 'Every attempt — sent, practice, rejected, failed — with time, recipient, account, and whether it was manual, scheduled, or part of a sequence. Searchable and filterable, updating in real time.' },
      { title: 'Sent mail lands in your Sent folder', body: 'Emails sent through Email Pilots are filed into your mailbox’s real Sent folder, so your phone and webmail show the full story.' },
      { title: 'Replies, collected', body: 'Your inboxes are checked every 15 minutes; replies from your contacts appear in one view with search, labels, and a one-click jump to the full conversation in your webmail.' },
      { title: 'Every contact has a story', body: 'A per-person drawer shows everything sent to them, their reply, their sequence position, and their block status in one place.' },
      { title: 'Numbers that add up', body: 'Lifetime and per-account totals for sends and replies, live on the dashboard.' },
      { title: '"While you were away"', body: 'Open the app after a quiet spell and get a short digest: who replied, what went out, what’s next.' },
      { title: 'A flight log', body: 'Every action the app takes is narrated in a running, human-readable log — including scheduled sends at the moment they fire.' },
      { title: 'Notifications that matter', body: 'Desktop notifications for new replies, bounces, and the moment a mailbox stops working — throttled so they inform rather than nag — with a persistent dashboard alert naming the failing account, and a gentle reminder if a healthy setup has sat idle for days.' },
      { title: 'Runs quietly in the background', body: 'Close the window and scheduling continues from the system tray; optional start-on-boot keeps the schedule alive after a restart.' },
    ],
  },
  {
    id: 'copilot-manual',
    system: 'SYS 09 · Copilot',
    title: 'An AI copilot that never phones home (optional)',
    items: [
      { title: 'One-click setup', body: 'Download the curated model (2.3 GB, integrity-verified before it ever runs) — resumable, and it keeps downloading in the background while you work — or point the app at any GGUF model you already have.' },
      { title: 'Uses your GPU', body: 'Hardware is probed automatically; NVIDIA, Vulkan, and Apple Metal acceleration are supported with sensible fallbacks.' },
      { title: 'A writing assistant in every composer', body: 'Write a first draft, improve, rewrite, or fix grammar — in five distinct tones — streamed live, applied only when you say so.' },
      { title: 'Personalization that learns from your wins', body: 'Per-prospect drafts are built from that contact’s own details (including your imported CSV columns) and guided by replies that previously went well.' },
      { title: 'Replies read and labeled', body: 'Incoming replies on Gmail and app-password inboxes are classified into eight useful buckets — interested, meeting booked, referral, out-of-office, negative, unsubscribe, bounce, other — right in your Replies view.' },
      { title: 'Hands-off hygiene (opt-in)', body: 'On those same inboxes, let the AI auto-file unsubscribe requests onto your do-not-send list, and keep sequences alive through out-of-office replies.' },
      { title: 'Completely private', body: 'Inference runs 100% on your machine. The only network traffic the AI ever creates is the one-time model download. Nothing you write or receive is sent to OpenAI, to us, or to any server.' },
    ],
  },
  {
    id: 'privacy',
    system: 'SYS 10 · Privacy',
    title: 'Private by design',
    items: [
      { title: 'Everything stays on your PC', body: 'Contacts, history, replies, settings — plain local files you can open, back up, or delete. No cloud account, no telemetry, no tracking.' },
      { title: 'Credentials in the OS vault', body: 'Passwords and Microsoft sign-in tokens are encrypted with Windows’ built-in protection. The app never displays a stored password back — not even to you.' },
      { title: 'Previews are sandboxed', body: 'Email HTML renders in a locked frame that can’t run scripts or touch the app.' },
      { title: 'Sign out means gone', body: 'Signing out wipes credentials, tokens, and account state completely.' },
    ],
  },
  {
    id: 'first-flight',
    system: 'SYS 11 · First Flight',
    title: 'A gentle start',
    items: [
      { title: 'Look around first', body: 'The sign-in screen has an explore mode — tour the whole app with sample data before connecting anything.' },
      { title: 'A guided tour that does things', body: 'A spotlight tour walks the key screens, with "do it" buttons that perform the step for you; short first-visit hints cover the rest.' },
      { title: 'Twenty-second demos', body: 'Three animated walkthroughs — adding a contact, a sequence stopping on a reply, a safe first send — built into the app, replayable anytime from the Help hub.' },
      { title: 'Checklists that retire themselves', body: 'Getting-started steps disappear after your first real send; a level-up checklist then points at sequences, domain authentication, and the AI — and retires too.' },
      { title: 'Practice Mode', body: 'Flip one switch and every send reroutes to your own inbox with full realism — same rendering, same pacing, same limits — so you can rehearse without emailing a single real contact. (And yes, your first real send gets confetti.)' },
    ],
  },
  {
    id: 'honest-limits',
    system: 'SYS 12 · By Design',
    title: 'What Email Pilots deliberately doesn’t do',
    items: [
      { title: 'No open or click tracking', body: 'No hidden pixels, no rewritten links. Success is measured the honest way: by replies. (Reply-rate analytics are built in.)' },
      { title: 'No cloud sync or team workspaces', body: 'All data lives on one machine, by design.' },
      { title: 'No automatic DNS editing', body: 'The domain checker verifies and recommends exact records; you paste them at your registrar yourself.' },
      { title: 'No drag-and-drop email builder', body: 'Templates are HTML you write or export from a design tool.' },
    ],
  },
];

/**
 * The Windows installer. The owner confirms the 1.0.0 URL stays valid; this is the only place it is written.
 */
export const DOWNLOAD = {
  kicker: 'Download',
  title: 'Email Pilots for Windows.',
  body: 'It runs entirely on your PC: your mailbox, your data, no cloud account. Install it, connect a mailbox (or explore with sample data first), and rehearse in Practice Mode before anything real flies.',
  requirements: 'Windows 10/11 · 64-bit',
  smartScreenNote: 'Windows SmartScreen may warn about new publishers. Choose "More info" → "Run anyway" — the installer is unmodified from this page.',
  cta: { label: 'Download for Windows', href: 'https://github.com/kryshn7777/Email-Pilots/releases/download/1.0.0/Email.Pilots.Setup.1.0.0.exe' },
};
