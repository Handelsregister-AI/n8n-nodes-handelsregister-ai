import { UserError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import {
  buildOrganizationQuery,
  buildSearchFilters,
  buildSearchRequest,
  buildSignalsQuery,
  extractApiError,
  isRetryableRequestError,
  MAX_RETRY_AFTER_DELAY_MS,
  MAX_SEARCH_PAGE_SIZE,
  MAX_TRANSIENT_REQUEST_RETRIES,
  normalizeApiUrl,
  normalizeDocumentResponse,
  parseStringArray,
  retryDelayMs,
  retryTransientRequest,
  SIGNAL_TOPICS,
  SIGNALS_PAGE_SIZE,
  TRANSIENT_RETRY_BASE_DELAY_MS,
  validatePersonQuery,
} from '../nodes/HandelsregisterAi/utils';

describe('HandelsregisterAi request utilities', () => {
  it('normalizes API URLs without changing paths', () => {
    expect(normalizeApiUrl('https://example.test///')).toBe('https://example.test');
    expect(normalizeApiUrl(undefined)).toBe('https://handelsregister.ai');
  });

  it('serializes organization features as repeated parameters', () => {
    const query = new URLSearchParams(
      buildOrganizationQuery(
        'BMW AG',
        ['related_persons', 'mergers_and_acquisitions'],
        true,
        false,
      ),
    );

    expect(query.get('q')).toBe('BMW AG');
    expect(query.getAll('feature')).toEqual(['related_persons', 'mergers_and_acquisitions']);
    expect(query.get('ai_search')).toBe('on-default');
  });

  it('rejects unsupported realtime feature combinations', () => {
    expect(() => buildOrganizationQuery('BMW AG', ['related_persons'], false, true)).toThrow(
      UserError,
    );
    expect(() => buildOrganizationQuery('BMW AG', ['publications'], false, true)).toThrow(
      /cannot be combined/i,
    );
  });

  it('supports filter-only search and caps each page at 30', () => {
    expect(MAX_SEARCH_PAGE_SIZE).toBe(30);
    const request = buildSearchRequest(
      '',
      {
        postal_code: '80331',
        pageSize: 30,
      },
      true,
    );

    expect(request.qs.q).toBeUndefined();
    expect(request.qs.limit).toBe(30);
    expect(request.qs.ai_mode).toBe('on-default');
    expect(JSON.parse(String(request.qs.filters))).toEqual({
      postal_code: '80331',
    });
    expect(buildSearchRequest('tech', { limit: 15 }, false).qs.limit).toBe(15);
  });

  it('rejects searches without q or filters and limits above 30', () => {
    expect(() => buildSearchRequest('', {}, false)).toThrow(/query or configure/i);
    expect(() => buildSearchRequest('tech', { limit: 31 }, false)).toThrow(/between 1 and 30/i);
    expect(() => buildSearchRequest('a', {}, false)).toThrow(/at least 2/i);
  });

  it('builds every filter shape and lets structured fields override JSON', () => {
    const filters = buildSearchFilters({
      filtersJson: JSON.stringify({
        postal_code: '00000',
        future_filter: 'kept',
      }),
      registration_date_from: '2024-01-01',
      registration_date_to: '2026-12-31',
      legal_form_code: 'GmbH, UG',
      industry_code: ['62.01', '62.02'],
      industry_scheme: 'WZ2025',
      active: 'false',
      postal_code: '80331',
      city: 'München',
      state: 'Bayern',
      latitude: 48.137,
      longitude: 11.575,
      location_max_distance_km: 25,
      registration_type: ['HRB', 'HRA'],
      registration_authority_name: 'München',
      registration_number: 'HRB 12345',
      company_size_category: 'medium',
      emp_count_gte: 50,
      emp_count_lte: 249,
      bs_assets_total_gte: 1_000_000,
      bs_equity_total_lte: 5_000_000,
      bs_liabilities_total_gte: 100_000,
      bs_cash_and_equivalents_lte: 1_000_000,
      bs_cash_to_liabilities_gte: 0.1,
      bs_equity_ratio_lte: 0.8,
      bs_debt_to_assets_gte: 0.2,
      pl_revenue_gte: 2_000_000,
      pl_net_income_lte: 500_000,
      pl_ebit_gte: 50_000,
    });

    expect(filters).toMatchObject({
      future_filter: 'kept',
      postal_code: '80331',
      legal_form_code: ['GmbH', 'UG'],
      industry_code: ['62.01', '62.02'],
      active: false,
      emp_size_category: 'medium',
      location_coordinates: { latitude: 48.137, longitude: 11.575 },
      location_max_distance_km: 25,
      financial_filters: {
        emp_count: { gte: 50, lte: 249 },
        bs_assets_total: { gte: 1_000_000 },
        bs_equity_ratio: { lte: 0.8 },
        pl_ebit: { gte: 50_000 },
      },
    });
    expect(filters).not.toHaveProperty('company_size_category');
    expect(filters).not.toHaveProperty('emp_count');
  });

  it('validates coordinates, distances, ranges, and ratios', () => {
    expect(() => buildSearchFilters({ latitude: 48 })).toThrow(/provided together/i);
    expect(() => buildSearchFilters({ location_max_distance_km: 10 })).toThrow(
      /requires latitude/i,
    );
    expect(() => buildSearchFilters({ emp_count_gte: 20, emp_count_lte: 10 })).toThrow(
      /minimum cannot be greater/i,
    );
    expect(() => buildSearchFilters({ bs_equity_ratio_gte: 1.1 })).toThrow(/between 0 and 1/i);
  });

  it('parses arrays and validates person context', () => {
    expect(parseStringArray('one, two')).toEqual(['one', 'two']);
    expect(parseStringArray(['one', '', 'two'])).toEqual(['one', 'two']);
    expect(() => validatePersonQuery('A', 'Company')).toThrow(/person name/i);
    expect(() => validatePersonQuery('Alice', 'C')).toThrow(/organization context/i);
    expect(() => validatePersonQuery('Alice', 'Company')).not.toThrow();
  });

  it('builds Signals filters with all topics, multiple organizations, dates, and a cursor', () => {
    expect(SIGNAL_TOPICS).toHaveLength(7);
    expect(SIGNALS_PAGE_SIZE).toBe(20);
    expect(
      buildSignalsQuery({
        topics: ['CAPITAL_CHANGES', 'TRANSFORMATIONS', 'CAPITAL_CHANGES'],
        organizationIds: 'org-one, org-two, org-one',
        fromDate: '2026-07-01',
        toDate: '2026-07-30T23:59:59Z',
        cursor: 'opaque-cursor',
      }),
    ).toEqual({
      topics: 'CAPITAL_CHANGES,TRANSFORMATIONS',
      organization_ids: 'org-one,org-two',
      from: '2026-07-01',
      to: '2026-07-30T23:59:59Z',
      cursor: 'opaque-cursor',
    });
  });

  it('rejects unknown Signal topics, invalid dates, and empty cursors', () => {
    expect(() => buildSignalsQuery({ topics: ['UNKNOWN'] })).toThrow(/unsupported signal/i);
    expect(() => buildSignalsQuery({ fromDate: 'not-a-date' })).toThrow(/ISO 8601/i);
    expect(() => buildSignalsQuery({ cursor: ' ' })).toThrow(/cursor/i);
  });

  it('normalizes PDF and SI document responses using response headers', () => {
    const pdf = normalizeDocumentResponse(
      {
        body: Buffer.from('%PDF'),
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="current-extract.pdf"',
        },
      },
      'entity',
      'AD',
    );
    expect(pdf.fileName).toBe('current-extract.pdf');
    expect(pdf.mimeType).toBe('application/pdf');

    const xml = normalizeDocumentResponse(Buffer.from('<root/>'), 'entity', 'SI');
    expect(xml.fileName).toBe('entity_SI.xml');
    expect(xml.mimeType).toBe('application/xml');
  });

  it('extracts useful API error fields without leaking request headers', () => {
    expect(
      extractApiError({
        response: {
          status: 402,
          data: {
            error: 'payment_required',
            detail: [{ msg: 'Not enough credits' }],
            meta: { message: 'Insufficient credits', request_credit_cost: 20 },
          },
        },
      }),
    ).toEqual({
      message: 'payment_required',
      statusCode: 402,
      code: 'payment_required',
      detail: [{ msg: 'Not enough credits' }],
      meta: { message: 'Insufficient credits', request_credit_cost: 20 },
    });
  });

  it('retries HTTP 408 responses up to three times with exponential backoff', async () => {
    const timeout = Object.assign(new Error('Request timeout'), {
      response: { status: 408 },
    });
    const request = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ ok: true });
    const sleep = vi.fn(async () => undefined);

    await expect(retryTransientRequest(request, sleep)).resolves.toEqual({ ok: true });
    expect(MAX_TRANSIENT_REQUEST_RETRIES).toBe(3);
    expect(request).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      TRANSIENT_RETRY_BASE_DELAY_MS,
      TRANSIENT_RETRY_BASE_DELAY_MS * 2,
      TRANSIENT_RETRY_BASE_DELAY_MS * 4,
    ]);
  });

  it('surfaces the fourth HTTP 408 response after exhausting retries', async () => {
    const timeout = Object.assign(new Error('Still timing out'), {
      httpCode: '408',
    });
    const request = vi.fn(async () => {
      throw timeout;
    });
    const sleep = vi.fn(async () => undefined);

    await expect(retryTransientRequest(request, sleep)).rejects.toBe(timeout);
    expect(request).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('retries rate limits, server failures, and common network failures', async () => {
    const rateLimit = Object.assign(new Error('Rate limited'), {
      response: { status: 429, headers: { 'Retry-After': '0.25' } },
    });
    const serviceUnavailable = Object.assign(new Error('Service unavailable'), {
      response: { statusCode: 503 },
    });
    const networkFailure = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
    const request = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(rateLimit)
      .mockRejectedValueOnce(serviceUnavailable)
      .mockRejectedValueOnce(networkFailure)
      .mockResolvedValueOnce({ ok: true });
    const sleep = vi.fn(async () => undefined);

    await expect(retryTransientRequest(request, sleep)).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      250,
      TRANSIENT_RETRY_BASE_DELAY_MS * 2,
      TRANSIENT_RETRY_BASE_DELAY_MS * 4,
    ]);
  });

  it('parses Retry-After seconds and dates while bounding excessive delays', () => {
    const now = Date.parse('2026-08-07T12:00:00Z');
    expect(
      retryDelayMs(
        { response: { headers: { 'retry-after': '3' } } },
        TRANSIENT_RETRY_BASE_DELAY_MS,
        now,
      ),
    ).toBe(3_000);
    expect(
      retryDelayMs(
        { response: { headers: { 'Retry-After': 'Fri, 07 Aug 2026 12:00:05 GMT' } } },
        TRANSIENT_RETRY_BASE_DELAY_MS,
        now,
      ),
    ).toBe(5_000);
    expect(
      retryDelayMs(
        { response: { headers: { 'Retry-After': '3600' } } },
        TRANSIENT_RETRY_BASE_DELAY_MS,
        now,
      ),
    ).toBe(MAX_RETRY_AFTER_DELAY_MS);
  });

  it('does not retry permanent API failures or unrelated programming errors', async () => {
    const unauthorized = Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
    });
    const unauthorizedRequest = vi.fn(async () => {
      throw unauthorized;
    });
    const programmingError = new TypeError('Invalid local value');
    const programmingRequest = vi.fn(async () => {
      throw programmingError;
    });
    const sleep = vi.fn(async () => undefined);

    expect(isRetryableRequestError(unauthorized)).toBe(false);
    expect(isRetryableRequestError(programmingError)).toBe(false);
    await expect(retryTransientRequest(unauthorizedRequest, sleep)).rejects.toBe(unauthorized);
    await expect(retryTransientRequest(programmingRequest, sleep)).rejects.toBe(programmingError);
    expect(unauthorizedRequest).toHaveBeenCalledTimes(1);
    expect(programmingRequest).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
