# Probity

**Before the money moves, prove who is asking.**

Probity checks a vendor's bank-change request before the payment run. It reads the letter twice, catches text a person can't see, screens every line for instructions aimed at an AI, and looks the vendor up in public registries and on the vendor's own website. Then it tells the accounts-payable clerk to **approve**, **call back** or **hold**, and gives them a number to call that did not come from the letter.

Live demo: **https://probity.pages.dev** · Built for the Nebius × NVIDIA Global AI Hackathon (Best Apps and Agents).

## Why

A forged "please update our bank details" letter is the cheapest way to steal a payment run. Payment policy says to call the vendor back on a number that didn't come from the request. In practice the clerk calls the number on the letter, because finding the right legal entity and its registered phone means three or four systems by hand. Public cases put a price on it: Baltimore City sent $1,524,621.04 to an impersonator after approving bank changes (OIG case 25-0028-I); the FBI's IC3 counted $3.05B in reported business e-mail compromise losses in 2025.

Probity is also built for the new version of that attack: letters that carry instructions for the AI reviewing them.

## What runs where

| Sponsor technology | What Probity does with it | Where you see it |
|---|---|---|
| **NVIDIA Nemotron 3 Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`) on **Nebius Token Factory** | The serious reasoning: reads the letter's claims from its text layer, then examines the vendor's identity against the evidence with thinking on | The three reasons on the Decide view |
| **NVIDIA Nemotron 3.5 Super VL** (`nvidia/Nemotron-3.5-Super-VL`) on Token Factory | Reads each page *image* as a second, independent reading; plans the registry and web lookups by tool calling | "What an AI reads" on the letter; the Scout's tool calls in Evidence |
| **NVIDIA Nemotron 3.5 Lightning** (`nvidia/Nemotron-3_5-Lightning`) on Token Factory | Screens every untrusted line (letter, e-mail, web pages) with thinking off; writes the decision up, and code checks every number it writes | The instruction screen; "Why, in full" |
| **Token Factory features** | Thinking switched per call (`chat_template_kwargs.enable_thinking`), structured output with a tool-call fallback, tool calling, image input, automatic prompt caching with cached tokens and cost recorded per call | Every call, with tokens in / cached / out and cost, in Evidence |
| **Nebius AI Cloud Serverless Jobs** | The overnight pre-run sweep: every weekday at 02:00 the app starts a CPU job through the Nebius REST API, signed in as a service account (an RS256 JWT signed with WebCrypto). The job posts signed results back | The inbox's "Pre-run sweep" card with the job id |
| **NVIDIA NeMo Guardrails 0.24.1** (in the Nebius job) | An input rail (`self check input`, our prompt) screens every line of every open request for instructions aimed at an automated reviewer; an output rail checks each written reason against its evidence. Both rails run Nemotron 3.5 Lightning on Token Factory | Sweep card; measured rates on "How it works" |
| **Tavily** Search + Extract | Finds the vendor's own website and reads its contact page: a second, independent source for the call-back number, plus the vendor's real domain to compare with the sender's | The call card ("Two sources agree. Neither came from the letter.") |

Public registries, queried live and cached: **SEC EDGAR** (registered phone and addresses), **USAspending** (UEI, legal name, parent), **GLEIF** (LEI, state file number).

**The verdict is code, not a model.** No model can approve a payment. Text found inside a letter is evidence, never an instruction: flagged lines reach later agents only as quoted data.

## Measured

On 30 labelled test letters, the NeMo Guardrails input rail (Nemotron 3.5 Lightning) caught **7 of 7** letters carrying hidden instructions, with **1 false alarm among 23** clean letters. The false alarm is a lookalike-vendor letter that asks the clerk not to contact the vendor's main office: flagged for hiding the request from a person, not for addressing an AI. (Nebius job `aijob-e04aer2esbfeqsgx64`, 30 Oct 2026.)

## Architecture

```
Browser ── probity.pages.dev (Cloudflare Pages) ── probity-web (Next.js on Workers, OpenNext)
                                                        │ service binding
                                                   probity-engine (Hono Worker)
                                                        ├─ Cloudflare Workflow: one step per agent, progress in D1
                                                        ├─ D1 (synthetic company, runs) · KV (registry + Tavily cache) · R2 (letters, page images)
                                                        ├─ Nebius Token Factory (every model call)
                                                        └─ cron, weekdays 02:00 MYT ──► Nebius Serverless Job (NeMo Guardrails) ──► signed callback
```

PDF handling runs inside the Worker: `unpdf` for text with size and position, the pdf.js operator list for text colour (white-on-white), and PDFium (WebAssembly) to render pages for Super VL. There are no containers.

## What is real and what is synthetic

- **Synthetic:** the buying company, its vendor records, ledger and payment runs, and every letter and e-mail. Letters that use a real company's name are fabricated and carry a "SYNTHETIC SAMPLE" notice in the document.
- **Real:** registry facts (SEC EDGAR, USAspending, GLEIF), web results, and every model call.

## Limits

- Registries cover US companies. A private vendor has no public phone number, so the number to call comes from our own records, never from the letter.
- The demo caps live checks per day and per visitor, and web lookups share a small free monthly budget. Recorded checks are free to open.
- Handwritten letters and poor scans are untested. Super VL reads one page image per call.

## Run it locally

Requirements: Node 22+, a Nebius Token Factory key, and optionally a Tavily key.

```bash
npm install
cd engine && printf 'NEBIUS_API_KEY=...\nTAVILY_API_KEY=...\n' > .dev.vars   # never commit this file
bash ../scripts/seed-local.sh            # local D1 + R2 with the synthetic company and letters
npx wrangler dev                         # engine on :8787
cd ../web && ENGINE_URL=http://localhost:8787 npx next dev -p 3200
```

`PROBITY_MOCK=1 npx next dev` in `web/` runs the UI on built-in sample data with no keys.

Deploy: `scripts/deploy.sh` (Cloudflare D1, KV, R2, the engine and web Workers, then the Pages front). The Nebius job lives in `job/`; after editing it, run `node scripts/embed-job.ts`.

## Licence

MIT. See [LICENSE](LICENSE).
