# GNAT / Centrality Local - current V8 extension and research

**Develop from [GNAT_Extension/](GNAT_Extension/), the user's current working version, not the historical V6 snapshot.** This repository preserves current source alongside earlier code and the GNAT investigation. Publication does not establish public redistribution rights or operational readiness.

## Quick path

1. Read [current baseline](CURRENT_BASELINE.md) for exact provenance, host dependencies and installation.
2. Read [start here](START_HERE.md), [state and gaps](STATE_AND_GAPS.md) and [AI working guide](AI_WORKING_GUIDE.md) before implementing one requested change.
3. For ChatGPT/Gemini without repository access, upload **both** [current source context](GNAT_CURRENT_CHAT_CONTEXT.md) and [historical research context](GNAT_V6_CHAT_CONTEXT.md). The current addendum overrides the historical baseline selection, not its research evidence.
4. Use [code map](CODE_MAP.md) to locate current code and historical references.

## Repository boundaries

| Location | Role |
| --- | --- |
| `GNAT_Extension/` | Current user-designated V8 Chrome extension; four originals copied byte-exact. Starting point for future behavior. |
| `snapshot/` | Preserved V6/V4, separate Python MOCK prototype, original research, fixtures and tests. Reference, not active implementation root. |
| `SOURCE_MANIFEST.json`, `V6_PROVENANCE.md`, `VALIDATION.md` | Historical V6 handoff provenance and validation only; not a current inventory or V8 test report. |
| `SHA256SUMS.txt` | Current ordinary repository files excluding `.git` and the checksum file itself. |
| `CURRENT_BASELINE.md` | Current four-file identity, exclusions and validation scope. |

The extension depends on the original GNAT/Centrality map and authenticated host page. It is **not an independent application**. Existing host tile sources can issue normal map requests; local editing is not a zero-network guarantee. Do not run unknown widgets or treat planning associations as electrical connectivity.

## Local verification

```sh
node --test tests/extension-publication.test.cjs
```

These checks cover exact imported bytes, manifest, syntax and exported CSV helpers. They do not prove browser behavior in GNAT. Earlier V4/Python/research tests do not cover the V8 browser runtime.

Historical [exclusions](EXCLUSIONS.md) remain relevant. No project datasets, captures, credentials or saved portal assets were added with V8. The existing GitHub destination is [GNAT](https://github.com/patricioaguilera367-hash/GNAT); commit/push outcomes are separate delivery evidence, not a source-code capability.
