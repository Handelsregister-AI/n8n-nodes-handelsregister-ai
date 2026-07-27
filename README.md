# @handelsregister/n8n-nodes-handelsregister-ai

An n8n community node for the [handelsregister.ai](https://handelsregister.ai) API. It provides structured German company, person, financial, ownership, registry-event, M&A, and document data.

## Installation

In n8n, open **Settings → Community Nodes**, select **Install**, and enter:

```text
@handelsregister/n8n-nodes-handelsregister-ai
```

For a manual installation:

```bash
npm install @handelsregister/n8n-nodes-handelsregister-ai
```

## Authentication

Create a **Handelsregister.ai API** credential in n8n and select one of:

- **API Key** — sends `x-api-key`
- **Bearer Token** — sends `Authorization: Bearer …`

You can obtain an API key from the [handelsregister.ai dashboard](https://handelsregister.ai/dashboard). The API URL defaults to `https://handelsregister.ai` and can be changed for compatible test environments.

## Operations

### Fetch Organization

Fetch an organization by company name, registration number, search query, or `entity_id`.

Base organization data includes the current and historical organization-level `representation_scheme`. Optional features are billed only when they return data, except for the separate AI surcharge.

| Feature                            | Additional credits |
| ---------------------------------- | -----------------: |
| Financial KPI                      |                  1 |
| Balance Sheet Accounts             |                  3 |
| Profit and Loss Account            |                  3 |
| Related Persons                    |                  2 |
| Publications                       |                  1 |
| News                               |                 10 |
| Insolvency Publications            |                  5 |
| Annual Financial Statements        |                  5 |
| Annual Financial Statements (HTML) |                  5 |
| Shareholders                       |                  5 |
| UBOs                               |                 10 |
| Shareholdings                      |                  5 |
| Mergers and Acquisitions           |                 20 |
| Website Content                    |                  0 |

Related-person records include organization- and role-level representation schemes with history. The publications feature is returned under the API response key `history`.

Organization requests have a 5-credit base price. AI Mode adds 20 credits. A successful Realtime Mode lookup adds 10 credits and cannot be combined with Related Persons or Publications.

### Search Organizations

Search by a text query, structured filters, or filters alone.

- Each API page contains at most 30 results.
- **Return All** requests successive pages of 30.
- **Maximum Results** optionally caps Return All.
- **Output** can return one n8n item per organization or the complete API response.
- AI Mode enables AI-assisted search for 5 credits.

Supported structured filters:

- Registration date from/to
- Legal-form codes
- Industry codes and classification scheme
- Active/inactive status
- Postal code, city, and state
- Latitude, longitude, and a 1–100 km radius
- Register type, authority, and number
- Company size category
- Employee-count range
- Balance-sheet asset, equity, liability, cash, and ratio ranges
- Revenue, net-income, and EBIT ranges

**Advanced Filters JSON** accepts a raw API filters object for forward compatibility. Explicit structured fields override matching keys in that object.

### Fetch Person

Fetch a person by name and organization context. The endpoint requires an active Plus, Pro, or Max subscription and has a 15-credit base price.

The optional Shareholdings feature adds 5 credits when data is returned. Person results include current and former organization roles, contact data, ownership data, and organization/role representation schemes.

### Fetch Document

Download official registry documents into the `data` binary property:

| Type                        | Format |
| --------------------------- | ------ |
| Shareholders List           | PDF    |
| Articles of Association     | PDF    |
| AD — Current Extract        | PDF    |
| CD — Historical Extract     | PDF    |
| SI — Structured Information | XML    |

The node uses the response `Content-Type` and server filename when available.

## Example workflow parameters

Fetch an organization with management and M&A data:

```json
{
  "operation": "fetchOrganization",
  "q": "BMW AG",
  "features": ["related_persons", "mergers_and_acquisitions"],
  "ai_search": false,
  "realtime_mode": false
}
```

Filter-only organization search:

```json
{
  "operation": "searchOrganizations",
  "q": "",
  "searchAiMode": false,
  "returnAll": false,
  "searchOutput": "split",
  "additionalFields": {
    "limit": 30,
    "postal_code": "80331",
    "legal_form_code": "GmbH, UG",
    "active": true,
    "pl_revenue_gte": 1000000
  }
}
```

Fetch an SI document:

```json
{
  "operation": "fetchDocument",
  "company_id": "20a1510e88cd2e9b166db4d0bc5d563d",
  "document_type": "SI"
}
```

## Error handling

API failures use n8n's API-aware node errors. With **Continue On Fail**, the output contains:

- `error`
- `status_code`, when available
- machine-readable `code`, when available
- API `detail`
- billing and credit `meta`

Credentials and request headers are never included in error output.

HTTP 408 Request Timeout responses are retried transparently up to three times with exponential backoff. Other HTTP failures are returned immediately.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run build
npm audit
npm pack --dry-run
```

The test suite covers request serialization, validation, search pagination, n8n item linking, authentication, documents, and structured errors. Docker end-to-end tests install the generated tarball into a clean n8n instance.

To run the same end-to-end matrix locally:

```bash
npm run pack:e2e
npm run docker:e2e:up
HANDELSREGISTER_API_KEY_THROW_AWAY=your_test_key npm run docker:e2e:test
npm run docker:e2e:down
```

The stack binds only to `127.0.0.1:5678`. The live test reads only `HANDELSREGISTER_API_KEY_THROW_AWAY` and exercises the supported company, person, and document operations with API-key authentication. To test a different n8n release, set `N8N_VERSION` for the Docker Compose command.

## Documentation and support

- [API documentation](https://handelsregister.ai/documentation)
- [GitHub issues](https://github.com/Handelsregister-AI/n8n-nodes-handelsregister-ai/issues)

## License

[MIT](LICENSE.md)
