# Changelog

All notable changes to this project are documented in this file.

## [0.5.0] - 2026-08-07

### Added

- Signals catalog, detail, and filtered list operations.
- All seven public Signal topics, including Pro insolvencies and Max transformations.
- Cursor-based Return All pagination, manual cursors, result caps, split/complete outputs,
  aggregated credit metadata, and repeated-cursor protection.
- Signals Docker end-to-end coverage for catalog, detail, pagination, plan topics, and multiple
  organization IDs.

### Changed

- Aligned node metadata, errors, connection types, icons, options, and peer dependencies with
  the current n8n community-node review rules.
- Renamed the organization-search `Limit` field to `Page Size` to reflect the API's 30-item
  page maximum. Workflows serialized with the previous `limit` field remain supported.
- Expanded transparent GET retries from HTTP 408 only to network errors, HTTP 408/429, and 5xx
  responses, with `Retry-After` support and bounded exponential backoff.
- Structured company-size and financial search filters now use the current API wire names and
  nested `financial_filters` shape.
- Updated the project contact email.
- Updated the development lockfile to resolve the latest transitive security advisory.

## [0.4.0] - 2026-07-27

### Added

- Mergers and acquisitions organization feature.
- Organization- and person-level representation-scheme support.
- Complete organization-search filters, filter-only searches, AI search, and Return All pagination.
- SI structured-information XML documents and content-aware filenames/MIME types.
- Bearer-token credentials.
- Structured API errors with status, detail, code, and billing metadata.
- Unit, request-contract, credential, pagination, binary-document, and item-linking tests.
- Reproducible Docker n8n end-to-end test setup.

### Changed

- Added transparent exponential-backoff retries for HTTP 408 responses, capped at three retries.
- Enforced the API maximum of 30 organization search results per page.
- Corrected feature credit descriptions.
- Updated documentation URLs and API examples.
- Updated the development toolchain and n8n workflow types.
- Standardized package management on npm.

## [0.3.1] - 2026-07-24

- Addressed n8n verification feedback and configured npm Trusted Publishing.
