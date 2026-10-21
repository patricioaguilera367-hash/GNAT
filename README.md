# GNAT V6 portable handoff

A **private, source-preserving coding handoff**, not a finished GNAT integration or authorized public release. Start here, not in the historical snapshots.

## Quick path

1. Read [start here](START_HERE.md), [provenance](V6_PROVENANCE.md), then [current state and gaps](STATE_AND_GAPS.md).
2. For an AI without repository tools, upload [GNAT_V6_CHAT_CONTEXT.md](GNAT_V6_CHAT_CONTEXT.md). It contains the full inventoried text corpus, not just summaries. Prefer upload to pasting its large contents; no particular provider's context/file limits are assumed.
3. For coding tools or a private repository, use `snapshot/` as the project root. [AI working guide](AI_WORKING_GUIDE.md) defines safe scope; [code map](CODE_MAP.md) locates original files.
4. Check [validation](VALIDATION.md), [source manifest](SOURCE_MANIFEST.json), [checksums](SHA256SUMS.txt) and [exclusions](EXCLUSIONS.md) before sharing.

## Contents

- Byte-exact `snapshot/v6.txt`: user-designated V6 browser-console IIFE. Its internal title/log still say CENTRALITY V4.
- Historical V4/legacy references; separate Python/SQLite/web Local application; diagnostic/export snippets; demo CSVs; offline tests.
- Complete allowlisted research corpus: current ledger, response-contract/coverage catalogs, historical investigations, transformed observed and synthetic fixtures, observer source/tests and three historical ODD task records.
- New English orientation guides and recovered interrupted-sector findings. Original files retain their languages and bytes.

The manifest is the exact inclusion list: 66 copied originals, 585,420 source bytes. No universal completeness claim is made. Saved portal/config assets, real data, credentials, private captures, caches and full raw conversation are not included. Originals were not deleted or rewritten.

## Two different execution contexts

| Context | Status |
| --- | --- |
| `snapshot/v6.txt` | Host-dependent console JavaScript; NOT standalone HTML, bookmarklet or Local application. No browser execution performed. |
| `snapshot/iniciar.py`, `app/`, `web/` | Existing Local prototype. GNAT disconnected, explicit MOCK fixtures only. Later research does not mean integration was implemented. |

Read the [original README](snapshot/README.md) for existing Local usage and tests. Running it may create local data; OSM opt-in sends external tile requests. This handoff does not authorize corporate requests, observer attachment, browser changes, portal execution, uploads or remote publishing.

## Private GitHub preparation

The directory can enter a separately authorized **private** repository after privacy/rights review. No repository initialized, staging/commit/remote operation or license added. [Publication boundary](EXCLUSIONS.md#publication-boundary) is mandatory. Original ignore policies are archived inertly because they hide included source; the new active `.gitignore` does not hide V6/V4 source.
