/**
 * Every word the site says, sourced from FEATURES.md (2026-08-08 audit).
 * Hard rules (FEATURES.md Appendix A/B):
 *  - none of the Appendix B banned phrases may appear anywhere in this file
 *    (verification greps for them — do not even quote them in comments)
 *  - "spam" only for the folder / filter checks
 *  - no tiers, license keys, or "upgrade"; no Buy button; no dark-mode claims
 *  - AI reply-labels framed for Gmail/app-password inboxes, never "every account"
 *  - the AI "suggests fixes" — it never "rewrites before sending"
 *  - unsubscribe machinery is claimed only for Bulk mode
 */

export interface ChapterCopy {
  id: string;
  kicker: string;
  title: string;
  body: string;
  chips: string[];
}

export const HOME_CHAPTERS: ChapterCopy[] = [
  {
    id: 'desk',
    kicker: 'CH 01 · The Desk',
    title: 'Some emails deserve a pilot.',
    body: 'Email Pilots is a Windows desktop app for personal outreach and follow-up — the emails you would write yourself if you had the time. Write once with merge fields like {{name}}; every contact gets their own values, with fallbacks so a missing one never prints a blank.',
    chips: ['Windows desktop · no cloud account', 'Per-person subject & message', 'A real mail-client preview, HTML + plain text'],
  },
  {
    id: 'preflight',
    kicker: 'CH 02 · Preflight',
    title: 'Ready for takeoff.',
    body: 'Connect any mailbox: sign in with Microsoft through Microsoft’s own page — no password ever touches the app — or use Gmail and custom SMTP with a guided app password. Every account is test-authenticated before it’s saved, and a pre-flight check audits your whole setup with a verdict and jump-to-fix buttons.',
    chips: ['Your mailbox + up to 5 more, in parallel', 'Provider settings auto-detected', 'One-click test email to yourself'],
  },
  {
    id: 'takeoff',
    kicker: 'CH 03 · Takeoff',
    title: 'Write once. It flies the follow-ups.',
    body: 'Sending stays human: weekly schedules with a ±minutes wobble, randomized pauses between emails, a daily cap per mailbox, and fresh accounts eased in from ~5 to ~50 a day. You hold the throttle — pause everything with one switch, and the dashboard always shows the next run and a 7-day plan.',
    chips: ['Warm-up ramp ~5 → ~50 a day', 'Max 3 emails to the same person per day', 'Live Today’s Usage meter'],
  },
  {
    id: 'formation',
    kicker: 'CH 04 · Formation',
    title: 'Your sequences, in formation.',
    body: 'Build a first email plus follow-ups with chosen waits, assign the sequence, and the app takes it from there. Before every follow-up it checks all your connected inboxes — the moment someone replies, their sequence stands down. Progress is saved after every single send, so a crash never re-sends a step.',
    chips: ['Stops the moment they reply', 'Vacation-proof with the optional local AI', 'CSV import — every column becomes a merge field'],
  },
  {
    id: 'storm',
    kicker: 'CH 05 · The Storm',
    title: 'Filters ground the fakes.',
    body: 'Before anything flies, subject, wording, links, and formatting are scored against common spam-filter triggers with plain-language findings. The on-device AI gives a second opinion and suggests concrete fixes — you decide what to apply. Dead addresses are caught early, before a send is wasted.',
    chips: ['Deliverability check in every preview', 'Mail-server checks catch bad domains first', 'Errors translated into plain English'],
  },
  {
    id: 'beacon',
    kicker: 'CH 06 · The Beacon',
    title: 'Cleared for delivery.',
    body: 'Email Pilots checks your domain’s SPF, DKIM, and DMARC records and hands you the exact DNS values to paste, with step-by-step instructions for common registrars. Personal Gmail and Outlook addresses are told, correctly, that there’s nothing to set up.',
    chips: ['Exact DNS values, ready to paste', 'Mismatch warnings before they hurt you', 'Personal vs Bulk sending style'],
  },
  {
    id: 'no-fly',
    kicker: 'CH 07 · The No-Fly List',
    title: 'Never the wrong person twice.',
    body: 'One do-not-send list covers every mailbox: bounced, unsubscribed, complained, or blocked by you. Hard bounces are detected at send time and from bounce messages that arrive later, and the address is retired automatically — forged bounce messages are recognized and ignored.',
    chips: ['Shared across all accounts, instantly', 'No accidental double-sends, ever', 'Block anyone in one click — undoable'],
  },
  {
    id: 'city',
    kicker: 'CH 08 · City of Inboxes',
    title: 'Delivered where it matters.',
    body: 'Emails are filed into your mailbox’s real Sent folder, so your phone and webmail show the full story. Replies are collected every 15 minutes into one view, every contact has a story drawer, and a running flight log narrates every action the app takes — including scheduled sends the moment they fire.',
    chips: ['Live Sent history — searchable, real time', '"While you were away" digest', 'Runs quietly from the system tray'],
  },
  {
    id: 'copilot',
    kicker: 'CH 09 · The Copilot',
    title: 'An AI that never phones home.',
    body: 'An optional on-device copilot: one click downloads the curated 2.3 GB model (integrity-verified, resumable) or point it at any GGUF you already have. It drafts, improves, and fixes grammar in five tones, personalizes from each contact’s own details, and labels replies on Gmail and app-password inboxes into eight useful buckets. Inference runs 100% on your machine.',
    chips: ['NVIDIA · Vulkan · Metal acceleration', 'Learns from replies that went well', 'Zero cloud servers — nothing leaves your PC'],
  },
  {
    id: 'landing',
    kicker: 'CH 10 · The Landing',
    title: 'The reply is the landing.',
    body: 'No open tracking, no hidden pixels, no rewritten links — success is measured the honest way: by replies, with reply-rate analytics built in. Contacts, history, and credentials stay in plain local files on your PC, protected by Windows’ own vault. Try the whole cockpit in explore mode, rehearse in Practice Mode, and your first real send gets confetti.',
    chips: ['7-day free trial · no credit card', 'Everything stays on your PC', 'Sign out wipes it all'],
  },
];

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

/** The Flight Manual — every FEATURES.md claim, §1–11 + §13. */
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
      { title: 'Your mailbox plus up to 5 more', body: 'Extra accounts send in parallel, each with its own daily allowance and health indicator, with bulk enable / disable / test / remove and a fleet overview strip.' },
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
    title: 'Land in the inbox',
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
      { title: 'Credentials in the OS vault', body: 'Passwords, Microsoft sign-in tokens, and your license are encrypted with Windows’ built-in protection. The app never displays a stored password back — not even to you.' },
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
      { title: 'No "Sign in with Google"', body: 'Google connects via an app password (guided in-app); one-click sign-in exists for Microsoft accounts only.' },
    ],
  },
];

export const PRICING = {
  kicker: 'Boarding pass',
  title: 'One simple plan.',
  price: '$2.9',
  period: '/week',
  bullets: [
    '7-day free trial — no credit card to start',
    'Cancel anytime',
    'One subscription, your own mailbox',
    'No per-seat or per-contact fees',
    'Your mailbox + up to 5 more',
  ],
  note: 'Runs entirely on your PC. Your mailbox, your data.',
  cta: { label: 'Start the free trial', href: '/download' },
};

export const FAQ = [
  { q: 'Do I need a new email address or server?', a: 'No. Email Pilots sends from your own mailbox — Gmail, Microsoft, or any custom SMTP host. Nothing to migrate, no shared sending pools.' },
  { q: 'Is my data stored in a cloud?', a: 'No. Contacts, history, replies, and settings are plain local files on your PC. No cloud account, no telemetry, no tracking.' },
  { q: 'How does the free trial work?', a: '7 days, full app, no credit card to start. Cancel anytime.' },
  { q: 'Does the AI send my text to a server?', a: 'Never. The optional copilot runs 100% on your machine; its only network traffic is the one-time model download.' },
  { q: 'What happens when someone replies?', a: 'Their sequence stands down automatically — any of your connected inboxes counts — and the reply appears in your Replies view within 15 minutes.' },
];

export const DOWNLOAD = {
  kicker: 'The Runway',
  title: 'Land it on your desktop.',
  body: 'Email Pilots runs entirely on your Windows PC — your mailbox, your data, no cloud account. Download, connect a mailbox (or just explore with sample data), and rehearse in Practice Mode before anything real flies.',
  requirements: 'Windows 10/11 · 64-bit',
  smartScreenNote: 'Windows SmartScreen may warn about new publishers. Choose "More info" → "Run anyway" — the installer is unmodified from this page.',
  // release URL lands with the deploy phase; the button is disabled until then
  cta: { label: 'Download for Windows', href: '#', pending: true },
};
