# Email Pilots — Feature List

> Landing-page source of truth, produced from a full codebase audit (2026-08-08).
> Every claim below is implemented and verified in the current build. Anything half-built
> or risky to advertise is quarantined in **Appendix A**; wording rules live in **Appendix B**.

Email Pilots is a Windows desktop app for **personal outreach and follow-up** — the emails
you'd write yourself if you had the time. It sends from your own mailbox (Gmail, Microsoft,
or any custom SMTP host), keeps every follow-up human-paced, reads the replies, and runs
entirely on your PC. No cloud account, no servers, no per-contact fees.

**Built for:** founders, recruiters, job-seekers, and freelancers & agencies.

---

## 1. Connect any mailbox

- **Sign in with Microsoft — no password.** Outlook, Hotmail, and Microsoft 365 connect
  through Microsoft's own sign-in page in your system browser. Email Pilots never sees a
  password; mail is sent through Microsoft's official API, and replies and bounces are read
  the same way.
- **Gmail and custom SMTP via app password.** A two-slide animated guide walks you through
  creating an app password on Google's or Microsoft's real settings pages — and pasting it
  with spaces still works.
- **The app knows your provider.** Type an address and Email Pilots fills in the right
  server settings automatically, checking the domain's mail records when it isn't obvious.
- **Verified before saved.** Every account is test-authenticated before it's added, and a
  one-click "Send test email to myself" proves the whole pipeline end to end.
- **Your mailbox plus up to 5 more.** Extra accounts send in parallel, each with its own
  daily allowance and health indicator, with bulk enable / disable / test / remove and a
  fleet overview strip.

## 2. Write once, personal every time

- **Templates with merge fields.** Write `{{name}}` or `{{company}}` once; every contact
  gets their own values, with per-field fallbacks (`{{ name | there }}`) so a missing value
  never prints a blank.
- **Per-person subject and message.** Any contact can override the defaults entirely.
- **Campaigns.** Group contacts into named campaigns, each with its own subject and
  template — one app, several parallel efforts that never bleed into each other.
- **A real preview, not a guess.** See any email exactly as the recipient will, in a
  mail-client-style preview with HTML and plain-text tabs. A clean plain-text version of
  every email is generated automatically.
- **Attachments that follow the person.** A shared document for everyone, a per-person file
  (a tailored CV, a specific proposal), or both — with custom filenames.

## 3. Bring your people in, in minutes

- **CSV import with column mapping.** Headers are auto-detected, you confirm the mapping,
  and every extra column becomes a merge field you can use in your message. Duplicates and
  invalid addresses are skipped and counted, so you know exactly what landed.
- **A three-step wizard for one-offs.** Who → What → When, with a live preview before you
  commit.
- **One person, two mailboxes.** Duplicate a contact to send to them from a second account
  without the two copies interfering.
- **Spread the load.** Distribute contacts across your accounts in one action.

## 4. Follow-ups that stop themselves

- **Multi-step sequences.** Build a first email plus follow-ups with a chosen wait between
  each step; assign a sequence to any contact and the app takes it from there.
- **Stops the moment they reply.** Before every follow-up, Email Pilots checks whether the
  person has answered — any of your connected inboxes counts — and cancels the rest of the
  sequence if they have.
- **Vacation-proof (optional).** With the local AI enabled, an out-of-office auto-reply on
  a Gmail or app-password inbox can be told apart from a real answer, so a beach week
  doesn't silently end your sequence.
- **Progress that survives anything.** Each person's place in a sequence is saved after
  every single email — a crash, restart, or edit to the sequence never re-sends a step or
  skips one.

## 5. Send like a human, automatically

- **Weekly schedules per contact.** Pick days and up to five times, each with a ±minutes
  wobble so nothing fires at a robotic 09:00:00 sharp.
- **Bulk scheduling with natural spread.** Give a group a time window and each person gets
  their own random slot inside it.
- **Human pauses between emails.** Consecutive sends are separated by a randomized gap of
  minutes, not milliseconds.
- **Built-in limits that protect your reputation.** A daily cap per mailbox, smaller
  per-batch caps, and a maximum of 3 emails to the same person per day.
- **New mailboxes are eased in.** A fresh account ramps from ~5 to ~50 emails a day over
  its first days instead of going full speed on day one — with a one-day override when you
  genuinely need it lifted.
- **Watch the limits work.** A live Today's Usage meter shows emails sent against today's
  cap, where you are in the current batch, and where the warm-up ramp currently sits.
- **You hold the throttle.** Pause or resume all sending with one switch, send to everyone
  now when you decide, and check for replies on demand.
- **You always know what's next.** The dashboard shows the next run and a 7-day plan of
  every upcoming send and follow-up.

## 6. Never email the wrong person twice

- **One do-not-send list across all mailboxes.** Bounced, unsubscribed, complained, or
  blocked by you — once an address is on the list, no account will email it again.
- **Bounces handled for you.** Hard bounces are detected both at send time and from the
  bounce messages that arrive later, and the address is retired automatically. Forged
  bounce messages are recognized and ignored.
- **No accidental double-sends.** The scheduler won't re-email someone you already emailed
  manually today, and re-running a send skips everyone who already received that exact
  email.
- **Block anyone in one click.** A manual do-not-send entry takes effect everywhere,
  instantly — and can be undone just as easily.

## 7. Land in the inbox

- **A pre-flight check before anything flies.** A dashboard card audits your whole setup —
  inbox connected, accounts healthy, subject written, sending style chosen, schedules in
  place, today's allowance — and gives a verdict: **Ready for takeoff**, or **Grounded**
  with a jump-to-fix button next to every blocker.
- **Deliverability check before you send.** Subject, wording, links, and formatting are
  scored against common spam-filter triggers, with plain-language findings — in the preview
  of every email and in a dedicated Deliverability lab.
- **AI second opinion (optional).** The on-device AI reviews a draft and suggests concrete
  fixes — you decide what to apply.
- **Domain authentication, demystified.** Email Pilots checks your domain's SPF, DKIM, and
  DMARC records and hands you the exact DNS values to paste, with step-by-step instructions
  for common registrars. Personal Gmail/Outlook addresses are told, correctly, that there's
  nothing to set up.
- **Mismatch warnings before they hurt you.** If your Microsoft sign-in address doesn't
  match the domain you're sending as, the app warns you before receivers start junking
  your mail.
- **Personal vs. Bulk sending style.** Personal mode makes every email look exactly like
  one you typed by hand. Bulk mode adds a legal footer, your mailing address, and one-click
  unsubscribe headers.
- **Bad addresses caught early.** Recipient domains are checked for working mail servers —
  including domains that explicitly refuse all mail — before a send is wasted on them.
- **Errors in plain English.** Connection problems are translated into what actually
  happened and what to do next — including steering Microsoft users to the modern sign-in
  when a password can no longer work.

## 8. Know exactly what happened

- **A live Sent history.** Every attempt — sent, practice, rejected, failed — with time,
  recipient, account, and whether it was manual, scheduled, or part of a sequence.
  Searchable and filterable, updating in real time.
- **Sent mail lands in your Sent folder.** Emails sent through Email Pilots are filed into
  your mailbox's real Sent folder, so your phone and webmail show the full story.
- **Replies, collected.** Your inboxes are checked every 15 minutes; replies from your
  contacts appear in one view with search, labels, and a one-click jump to the full
  conversation in your webmail.
- **Every contact has a story.** A per-person drawer shows everything sent to them, their
  reply, their sequence position, and their block status in one place.
- **Numbers that add up.** Lifetime and per-account totals for sends and replies, live on
  the dashboard.
- **"While you were away."** Open the app after a quiet spell and get a short digest:
  who replied, what went out, what's next.
- **A flight log.** Every action the app takes is narrated in a running, human-readable
  log — including scheduled sends at the moment they fire.
- **Notifications that matter.** Desktop notifications for new replies, bounces, and the
  moment a mailbox stops working — throttled so they inform rather than nag — with a
  persistent dashboard alert naming the failing account, and a gentle reminder if a
  healthy setup has sat idle for days.
- **Runs quietly in the background.** Close the window and scheduling continues from the
  system tray; optional start-on-boot keeps the schedule alive after a restart.

## 9. An AI copilot that never phones home *(optional)*

- **One-click setup.** Download the curated model (2.3 GB, integrity-verified before it
  ever runs) — resumable, and it keeps downloading in the background while you work — or
  point the app at any GGUF model you already have.
- **Uses your GPU.** Hardware is probed automatically; NVIDIA, Vulkan, and Apple Metal
  acceleration are supported with sensible fallbacks.
- **A writing assistant in every composer.** Write a first draft, improve, rewrite, or fix
  grammar — in five distinct tones — streamed live, applied only when you say so.
- **Personalization that learns from your wins.** Per-prospect drafts are built from that
  contact's own details (including your imported CSV columns) and guided by replies that
  previously went well.
- **Replies read and labeled.** Incoming replies on Gmail and app-password inboxes are
  classified into eight useful buckets — interested, meeting booked, referral,
  out-of-office, negative, unsubscribe, bounce, other — right in your Replies view.
- **Hands-off hygiene (opt-in).** On those same inboxes, let the AI auto-file unsubscribe
  requests onto your do-not-send list, and keep sequences alive through out-of-office
  replies.
- **Completely private.** Inference runs 100% on your machine. The only network traffic the
  AI ever creates is the one-time model download. Nothing you write or receive is sent to
  OpenAI, to us, or to any server.

## 10. Private by design

- **Everything stays on your PC.** Contacts, history, replies, settings — plain local files
  you can open, back up, or delete. No cloud account, no telemetry, no tracking.
- **Credentials in the OS vault.** Passwords, Microsoft sign-in tokens, and your license
  are encrypted with Windows' built-in protection. The app never displays a stored password
  back — not even to you.
- **Previews are sandboxed.** Email HTML renders in a locked frame that can't run scripts
  or touch the app.
- **Sign out means gone.** Signing out wipes credentials, tokens, and account state
  completely.

## 11. A gentle start

- **Look around first.** The sign-in screen has an explore mode — tour the whole app with
  sample data before connecting anything.
- **A guided tour that does things.** A spotlight tour walks the key screens, with "do it"
  buttons that perform the step for you; short first-visit hints cover the rest.
- **Twenty-second demos.** Three animated walkthroughs — adding a contact, a sequence
  stopping on a reply, a safe first send — built into the app, replayable anytime from the
  Help hub.
- **Checklists that retire themselves.** Getting-started steps disappear after your first
  real send; a level-up checklist then points at sequences, domain authentication, and the
  AI — and retires too.
- **Practice Mode.** Flip one switch and every send reroutes to your own inbox with full
  realism — same rendering, same pacing, same limits — so you can rehearse without emailing
  a single real contact. (And yes, your first real send gets confetti.)

## 12. One simple plan

- **$2.9/week, 7-day free trial, no credit card to start, cancel anytime.** One
  subscription, your own mailbox, no per-seat or per-contact fees.
  *(Do not publish a Buy button yet: the license store isn't configured — activation
  currently refuses every key — and plan naming must be unified first. See Appendices
  A and B.)*

## 13. What Email Pilots deliberately doesn't do

Honest limits — several double as privacy selling points:

- **No open or click tracking.** No hidden pixels, no rewritten links. Success is measured
  the honest way: by replies. (Reply-rate analytics are built in.)
- **No cloud sync or team workspaces.** All data lives on one machine, by design.
- **No automatic DNS editing.** The domain checker verifies and recommends exact records;
  you paste them at your registrar yourself.
- **No drag-and-drop email builder.** Templates are HTML you write or export from a design
  tool.
- **No "Sign in with Google".** Google connects via an app password (guided in-app);
  one-click sign-in exists for Microsoft accounts only.

---

## Appendix A — Built, but don't advertise yet

Real code that exists in the build but must **not** appear in marketing until finished:

| What | State | Rule for copy |
|---|---|---|
| **License activation & Free / First Class tiers** | Activation UI, validation, and entitlement logic ship, but the store product IDs are placeholders (every key is refused) and **no feature is gated by tier** — Free currently equals First Class. A 219 MB free-tier AI model exists in the catalog but the UI never offers it (the tier-aware recommendation is unwired; the download button always fetches the 2.3 GB model). | Don't mention tiers, keys, or "upgrade" anywhere until the store is configured and at least one gate is wired. |
| **Browser-session webmail connect** (credential-less Gmail/Outlook) | Backend intact but has zero UI — no user can create such an account. Never verified live; automating webmail also carries provider-ToS risk. | Never mention. |
| **AI reply labels on Microsoft accounts** | Reply classification runs only on app-password (IMAP) accounts. Microsoft-connected accounts get replies and bounce handling, but no AI labels — so auto-unsubscribe filing and out-of-office tolerance don't apply there. | Don't promise "AI reads every reply on every account". Keep AI reply claims generic or Gmail-flavored. |
| **Automatic pre-send AI rewrite** | The current landing line "AI … rewrites the risky parts before a single message leaves" overstates it: the deliverability review is advisory and the rewrite is a button the user clicks. | Say "reviews each draft and suggests fixes" — never "rewrites before it leaves". |
| **One-click unsubscribe on every email** | The footer and List-Unsubscribe header exist only in **Bulk** mode. The default Personal mode deliberately sends without them. | Only claim unsubscribe machinery when describing Bulk mode. |
| **Dark mode** | None. Light theme only. | Don't show or imply dark UI in screenshots or copy. |

## Appendix B — Copy guardrails

- **Banned framing (payment-processor risk):** "cold email", "cold outreach", "mass email",
  "bulk blast", "email blast", "anti-ban", "bypass spam filters", "spintax". Email Pilots is
  **personal outreach and follow-up** — one person writing to people they want to reach.
- **The word "spam"** is allowed only when talking about the spam *folder* or spam-filter
  checks — never to describe what the user sends.
- **Plan naming is currently three-way inconsistent** and must be unified before pricing
  goes live: landing sells **"Solo" at $2.9/week**, the app's Settings card says **"Free" /
  "First Class"**, and the payment-store runbook defines **Weekly $2.90 + Monthly $10.00**.
  Pick one vocabulary end to end.
- **Numbers safe to quote:** your mailbox + up to 5 more; ~50 emails/day default cap per
  mailbox; warm-up ramp ~5 → ~50; replies checked every 15 minutes; 8 reply labels; 5
  writing tones; curated on-device AI model at 2.3 GB (a 219 MB free-tier model exists but
  isn't offered yet — see Appendix A); 7-day trial.
- **Honest superlatives only:** "100% local" and "zero cloud servers" are true and
  verifiable — lead with privacy, it's the differentiator.
