# Changelog

All notable changes to this project are documented in this file.

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
