# Probity

**Before the money moves, prove who is asking.**

Probity checks every vendor bank-change request before the payment run. It reads the request, catches text a person can't see, screens every line for instructions aimed at an AI, and looks the vendor up in public registries and on the vendor's own website. Then it tells the accounts-payable team to **approve**, **call back** or **hold**, and gives them a number to call that did not come from the request.

Live: **https://probity.pages.dev** · Built for the Nebius × NVIDIA Global AI Hackathon (Best Apps and Agents).

## Why

A forged "please update our bank details" e-mail is the cheapest way to steal a payment run. Payment policy says to call the vendor back on a number that didn't come from the request. In practice the clerk calls the number in the e-mail, because finding the right legal entity and its registered phone means three or four systems by hand. Public cases put a price on it: Baltimore City sent $1,524,621.04 to an impersonator after approving bank changes (OIG case 25-0028-I); the FBI's IC3 counted $3.05B in reported business e-mail compromise losses in 2025.

Probity is also built for the new version of that attack: requests that carry instructions for the AI reviewing them.

## The product

A company signs up with an e-mail code, creates its workspace, and connects what it already uses:

| Connect | What Probity does with it |
|---|---|
| **Gmail** or **Outlook** (one or several mailboxes, through Composio) | Every new e-mail is classified; a vendor asking to change bank or remittance details becomes a request and is checked automatically. Other mail is ignored and not stored. |
| **Xero** (through Composio, with our own Xero app) | Brings in the vendor list, the bank account on file and open bills, so a check knows the vendor of record and the money at risk in the next run. Syncs on connect, on demand, and before every run. |
| **Slack** (our own Slack app) | Each verdict lands in the AP channel with the number to call and buttons to log the call: confirmed, they didn't send it, no answer. The message updates in place. |
| **Vendors** | No Xero? Add vendors one by one, import a CSV, or load 35 sample vendors to try it. |
| **Payment runs** | The company sets its run days and cut-offs. Before each cut-off Probity re-checks every open request and sends the summary to Slack and by e-mail. A hold also e-mails the controller. |

Plans: **Free** has every feature with 100 checks a month; **Probity Plus** is $49 per company per month for 1,000 checks, billed through Dodo Payments. Judges: sign up, and on the plan step (or **Plan and billing**) enter `NEBIUSJUDGES`. It opens a Dodo checkout with a 100% discount, so a real $0 subscription is created and Plus turns on when Dodo confirms it.

The product lives under `/app` behind sign-in: a sidebar with the inbox, Check a letter, Vendors, Payment runs, Connections, Plan and billing, and in-app How it works and Pricing.

## What runs where

| Sponsor technology | What Probity does with it | Where you see it |
|---|---|---|
| **NVIDIA Nemotron 3 Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`) on **Nebius Token Factory** | The serious reasoning, thinking on: reads what the request asks (account, routing, signer, pressure), then examines the vendor's identity against the evidence | The reasons on the Decide view |
| **NVIDIA Nemotron 3.5 Super VL** (`nvidia/Nemotron-3.5-Super-VL`) on Token Factory | Reads the picture of each page as a second, independent reading; anything in the text layer that the picture does not show is flagged as hidden | "What an AI reads" on the letter; the "not visible" tags |
| **NVIDIA Nemotron 3.5 Lightning** (`nvidia/Nemotron-3_5-Lightning`) on Token Factory | Screens every untrusted line (letter, e-mail, web pages) with thinking off; plans the registry and web lookups by tool calling; writes the decision up, and code checks every number it writes; classifies incoming mail | The instruction screen; the Scout's tool calls in Evidence; "Why, in full" |
| **Token Factory features** | Thinking switched per call (`chat_template_kwargs.enable_thinking`), structured output with a tool-call fallback, tool calling, automatic prompt caching, with tokens in / cached / out and cost recorded per call | Every call, with its cost, in Evidence. A typical check costs about $0.02. |
| **NVIDIA NeMo Guardrails 0.24.1** on a **Nebius AI Cloud Serverless Job** | An input rail (`self check input`, our prompt) screens every line of every open request for instructions aimed at an automated reviewer; an output rail tests each written reason against its evidence. Both rails run Nemotron 3.5 Lightning on Token Factory. The job is started from the Nebius CLI (`scripts/start-sweep.sh`) for the measured evaluation and bulk re-screens, and posts signed results back | "Before every payment run" on How it works, with the job id and measured rates |
| The same rails, in the app | Before each company's cut-off, the cron runs the same rail definitions inside the app through Token Factory | The pre-run summary in Slack and by e-mail |
| **Tavily** Search + Extract | Finds the vendor's own website and reads its contact page: a second, independent source for the call-back number, plus the vendor's real domain to compare with the sender's | The call card ("Two sources agree. Neither came from the letter.") |

Public registries, queried live and cached: **SEC EDGAR** (registered phone and addresses), **USAspending** (UEI, legal name, parent), **GLEIF** (LEI, state file number).

**The verdict is code, not a model.** No model can approve a payment. Text found inside a request is evidence, never an instruction: flagged lines reach later agents only as quoted data.

**Two readings.** Nemotron 3 Ultra reads the text layer; Nemotron 3.5 Super VL reads the picture of each page on its own, and anything in the text that the picture does not show is flagged. On 30 October 2026 Super VL was briefly unavailable on Token Factory; the read is now skipped (not failed) whenever the model is missing, and the registry lookups run on Lightning either way.

## Measured

On 39 labelled test letters, the NeMo Guardrails input rail (Nemotron 3.5 Lightning) caught **16 of 16** letters carrying instructions aimed at an AI reviewer, with **0 false alarms among 23** clean letters (Nebius job `aijob-e04y3vcr83c83ejsfd`, 30 Oct 2026). Nine of the 16 are deliberately hard: zero-width splits, look-alike characters, base64, Spanish and German, plain business voice, and instructions only in an annotation, the image or the metadata. Before screening, the job strips invisible characters, maps look-alike letters to Latin and decodes base64; it then screens each letter in overlapping windows. The clean set includes urgent and secretive letters that pressure the clerk; those are left to the clerk and the other checks.

How to read this honestly: the image-only letter has no text, so the rail blocks it as empty input rather than by reading it (a scan with no text layer goes to the clerk in the app as well). On a dozen extra letters written to test for over-fitting, one clean "do not phone, write only" letter was still flagged. Earlier runs on the same set: 14 of 16 and 1 false alarm (`aijob-e04h7gjahz57cvkn7a`), and 7 of 7 on the first 30 letters (`aijob-e04aer2esbfeqsgx64`). The test set and results will be published as an open benchmark.

## A fine-tuned Nemotron screen (measured, not yet in live checks)

We LoRA-tuned **NVIDIA Llama-3.1-Nemotron-Nano-4B-v1.1** (NVIDIA Open Model License) for the same task: does a letter carry an instruction aimed at an AI reviewer? Training ran in one **Nebius AI Cloud Serverless Job on 1x H100** in eu-north1 (`aijob-e00d4hdmhnwrthgr63`, 30 Oct 2026: 9 min wall, 3.3 min training; LoRA r=16, alpha=32, 3 epochs, bf16).

- **Data:** 1,406 letters written by Nemotron 3.5 Lightning on Token Factory from structured specs, so every label is exact. Code only re-encodes or moves Nemotron's text (zero-width splits, look-alike letters, base64 or hex, metadata-only lines); it adds no words. 61% are clean, and 45% of those are hard negatives: fraudulent or pushy letters that pressure the clerk but address no AI. No test letter or paraphrase was used. A dedupe check against the 39 test letters dropped nothing; the highest word 8-gram overlap was 0.02.
- **Held-out 39 letters:**

| Model | Caught (of 16) | False alarms (of 23) |
|---|---|---|
| Base Nemotron Nano 4B, zero-shot | 16 | 19 |
| Same model after LoRA tuning | 15 | 0 |
| NeMo Guardrails rail in production | 16 | 0 |

- **Reading it honestly:** the tuned model's one miss is the letter whose instruction exists only in the page image (it has no text); a text-only model cannot see it; in a live check the page image goes to the vision reading instead. The earlier run with less balanced data (`aijob-e00e213g7c30qbq7rh`) reached 15/16 with 10/23 false alarms. Cost for both runs: about $0.15 of Token Factory and roughly $1-2 of H100 time.
- **Status:** live checks still use the NeMo Guardrails rail. The adapter was not yet persisted; `scripts/start-finetune.sh` and `job/finetune/` reproduce the run.

## Architecture

```
Browser ── probity.pages.dev (Cloudflare Pages) ── probity-web (Next.js on Workers, OpenNext)
                                                        │ service binding
                                                   probity-engine (Hono Worker)
                                                        ├─ Better Auth (e-mail code, workspaces) · Dodo Payments webhooks
                                                        ├─ Cloudflare Workflow: one step per agent, progress in D1
                                                        ├─ D1 (companies, vendors, requests, runs) · KV (registry + Tavily cache) · R2 (letters)
                                                        ├─ Nebius Token Factory (every model call)
                                                        ├─ Composio (Gmail, Outlook, Xero) ──► new-mail webhook
                                                        ├─ Slack (verdicts, buttons) · Cloudflare Email (codes, holds, summaries)
                                                        └─ cron every 5 min: each company's pre-run re-check before its cut-off

Nebius CLI ──► Nebius AI Cloud Serverless Job (NeMo Guardrails) ──► signed callback to the engine
```

PDF handling runs inside the Worker: `unpdf` for text with size and position, and the pdf.js operator list for text colour (white-on-white). There are no containers.

## What is real and what is synthetic

- **Real:** your own mailbox, Xero and Slack once connected; registry facts (SEC EDGAR, USAspending, GLEIF); web results; every model call.
- **Synthetic:** the shared demo company ("Halvorsen Mission Systems"), its vendor records, ledger and payment runs, and its letters. Letters that use a real company's name are fabricated and carry a "SYNTHETIC SAMPLE" notice in the document. The 35 sample vendors are copies of the demo company's.

## Limits

- Registries cover US companies. A private vendor has no public phone number, so the number to call comes from the company's own records, never from the request.
- New mail reaches Probity through Composio's Gmail and Outlook triggers, which poll; in testing a Gmail message took about 10 minutes to arrive.
- Outlook is built the same way as Gmail but has not been tested against a live Microsoft mailbox.
- If Token Factory stops serving Super VL, the page-image reading is skipped and a scan with no text layer goes to the clerk. Handwritten letters are untested.
- The demo company caps live checks per day and per visitor, and web lookups share a small monthly budget. Recorded checks are free to open.

## Run it locally

Requirements: Node 22+, a Nebius Token Factory key, and optionally a Tavily key.

```bash
npm install
cd engine && printf 'NEBIUS_API_KEY=...\nTAVILY_API_KEY=...\n' > .dev.vars   # never commit this file
bash ../scripts/seed-local.sh            # local D1 + R2 with the demo company and letters
npx wrangler dev                         # engine on :8787
cd ../web && ENGINE_URL=http://localhost:8787 npx next dev -p 3200
```

`PROBITY_MOCK=1 npx next dev` in `web/` runs the UI on built-in sample data with no keys.

Deploy: `scripts/deploy.sh` (Cloudflare D1, KV, R2, the engine and web Workers, then the Pages front). The Nebius job lives in `job/`; after editing it, run `node scripts/embed-job.ts`, and start it with `scripts/start-sweep.sh`.

## Licence

MIT. See [LICENSE](LICENSE).
