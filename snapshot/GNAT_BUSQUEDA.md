# GNAT pole search — confirmed observations

Observed on 2026-10-21 using Chrome DevTools MCP in the existing authenticated Chrome tab. GNAT is displayed as **Centrality - Mapa** (previously confirmed; not re-investigated).

## Initial investigation scope and safety

- Only the map search field was used, once for each requested code.
- No candidates were selected; no detail sheets, widgets, or unrelated requests were inspected.
- No application write actions, code changes, scripted requests, or request replays were performed. Search itself uses HTTP POST; the observed action was `textual_search`.
- The search field was left containing `F562512`.
- Session cookies, user identity, internal hostname, and raw headers are intentionally excluded. Actual pole codes and candidate IDs below are retained because they are the explicitly requested findings; the separate examples are anonymized.

## Confirmed request contract

Both searches generated an XMLHttpRequest with:

- Method: `POST`
- Endpoint: `/backend/saesa/svc_wmc.php?_dc=<observed numeric value>`
- Request content type: `application/x-www-form-urlencoded; charset=UTF-8`
- Body fields: `query`, `action=textual_search`, `page=1`, `start=0`, `limit=25`
- Response status: `200`
- Response content type: `text/html; charset=UTF-8`, although the observed body is JSON.
- Response structure: `success` and a `data` array of candidate objects.

The purpose of `_dc` was not investigated. No claim is made about its necessity.

## Confirmed results

| Search query | DevTools request ID | HTTP | `object_id` | `surrogate_in_map_id` | `pin_location` | Exact `display` value |
| --- | --- | --- | --- | --- | --- | --- |
| `FAP1783` | `3` | `200` | `5018289` | `5018289` | `null` | `FAP1783 (Poste C.A. 11.5 m Empresa (MT/BT/AP))` |
| `F562512` | `4` | `200` | `4668365` | `4668365` | `null` | `F562512 (Postes c.a. 10 m  350 Kg/Rup cte. comun con BT)` |

Each observed response contained `success: true` and exactly one entry in `data`. Request IDs are local DevTools capture references, not application identifiers. The second description contains two spaces between `m` and `350`, preserved above.

The matching identifier values and null locations describe only these two responses. Their general meaning, uniqueness, interchangeability, completeness across pages, and behavior after candidate selection were not investigated.

## Anonymized examples

These examples preserve the observed field structure but replace the hostname, pole code, IDs, and descriptive asset details. They are illustrative, not additional observations or executable instructions.

```http
POST https://gnat.example.invalid/backend/saesa/svc_wmc.php?_dc=<redacted>
Content-Type: application/x-www-form-urlencoded; charset=UTF-8

query=POLE_EXAMPLE&action=textual_search&page=1&start=0&limit=25
```

```json
{
  "success": true,
  "data": [
    {
      "object_id": 1000001,
      "surrogate_in_map_id": 1000001,
      "pin_location": null,
      "display": "POLE_EXAMPLE (anonymized pole description)"
    }
  ]
}
```

## Completion and limits

Both requested searches and their request/response bodies were inspected once. No further network collection is required to substantiate the findings above. No details, widgets, selection requests, or write endpoints were explored. Server-side implementation and absence of incidental server logging were not verified.

## Follow-up: shared codes and multiple asset candidates

Three additional searches were performed once each on 2026-10-21. Earlier confirmed searches were not repeated. Each used the same observed endpoint and body fields, changing only `query`, and returned HTTP 200 with `success: true`. No candidates were clicked; detail sheets, widgets, and map positioning after selection remain unverified. The search field was left containing `F514139`.

### F562515 — request 3994, two candidates

| `object_id` = `surrogate_in_map_id` | Exact `display` |
| --- | --- |
| `5338713` | `F562515 (Postes c.a. 10 m  350 Kg/Rup cte. comun con BT)` |
| `11664050` | `F562515 (Desconectador Fusible Empresa)` |

### F56822 — request 3995, twelve candidates

| `object_id` = `surrogate_in_map_id` | Exact `display` |
| --- | --- |
| `24684751` | `F56822 (Poste c.a. 8.7 y/o 9 m. 350 Kg/Rup lit.)` |
| `5537357` | `F568222 (Postes c.a. 11.5 m 350 Kg/Rup cte. comun con BT)` |
| `5648567` | `F568221 (Postes c.a. 10 m  350 Kg/Rup cte. comun con BT)` |
| `5603200` | `F568223 (Postes c.a. 11.5 m 350 Kg/Rup cte. comun con BT)` |
| `4896174` | `F568225 (Postes c.a. 11.5 m 350 Kg/Rup cte. comun con BT)` |
| `5351275` | `F568226 (Postes c.a. 10 m  350 Kg/Rup cte. comun con BT)` |
| `4778433` | `F568227 (Postes c.a. 10 m  350 Kg/Rup cte. comun con BT)` |
| `8774696` | `F568227 [F568227] (Desconectador Fusible Empresa)` |
| `8774845` | `F568227 [F568227] (Desconectador Fusible Empresa)` |
| `5634886` | `F568228 (Postes c.a. 11.5 m 350 Kg/Rup cte. comun con BT)` |
| `3243295` | `F568225 [F59002] (Desconectador Fusible Empresa)` |
| `4348873` | `F568225 [F59002] (Eq.protección BT1 Fas.5KVA)` |

The response includes longer codes as well as the exact requested code: search is not restricted to exact code equality in this case. Two candidates have identical `display` text but different IDs (`8774696` and `8774845`); labels alone cannot uniquely identify a candidate. No general matching algorithm or explanation for the duplicate labels was established.

### F514139 — request 3996, four distinct candidates

| Asset label | `object_id` = `surrogate_in_map_id` | Exact `display` |
| --- | --- | --- |
| Pole | `4013068` | `F514139 (Postes c.a. 10 m  350 Kg/Rup cte. comun con BT)` |
| DBC | `28557382` | `F514139 [F514139] (DBC ABB NXA 36KV)` |
| DC | `28557387` | `F514139 [F514139] (DC Pole Top 900A 25kV)` |
| Fuse disconnector (DF, user terminology) | `28557371` | `F514139 [F66023] (Desconectador Fusible Empresa)` |

All eighteen follow-up candidates have `pin_location: null`. Each candidate's two ID fields match in these observed responses.

### Interpretation: confirmed versus user-provided context

- **Confirmed by responses:** the same leading code can occur for the pole and multiple distinct equipment candidates. In particular, `F514139` returns the pole, DBC, DC, and fuse disconnector with four distinct object IDs. A search code is therefore not a unique asset identifier in these results.
- **Confirmed label distinction:** the fuse disconnector under `F514139` is displayed with bracketed code `[F66023]`, not `[F514139]`. Preserve both portions of the label rather than treating them as interchangeable.
- **User-provided domain context:** DC means desconectador cuchilla, DBC means desconectador bajo carga, and DF means desconectador fusible; equipment may be physically mounted on the same pole. The user explains that selecting a candidate opens its own information and positions the map on that equipment.
- **Not independently verified:** physical mounting, formal meaning of the leading versus bracketed codes, selection request contract, equipment coordinates, and actual post-selection map/detail behavior. Search responses alone do not prove these relationships.
- **Practical implication from confirmed evidence:** retain every candidate's object ID and full description. Do not collapse candidates by search code or display text, and do not silently choose the pole when the intended asset may be equipment.

### Additional anonymized multi-candidate response example

Synthetic values below illustrate the observed structure without reproducing real identifiers or codes:

```json
{
  "success": true,
  "data": [
    {"object_id": 1000001, "surrogate_in_map_id": 1000001, "pin_location": null, "display": "POLE_A (anonymized pole description)"},
    {"object_id": 1000002, "surrogate_in_map_id": 1000002, "pin_location": null, "display": "POLE_A [POLE_A] (DBC anonymized model)"},
    {"object_id": 1000003, "surrogate_in_map_id": 1000003, "pin_location": null, "display": "POLE_A [POLE_A] (DC anonymized model)"},
    {"object_id": 1000004, "surrogate_in_map_id": 1000004, "pin_location": null, "display": "POLE_A [DEVICE_B] (anonymized fuse disconnector)"}
  ]
}
```
