import { describe, expect, it, vi } from 'vitest';

import {
  buildOrganizationQuery,
  buildSearchFilters,
  buildSearchRequest,
  extractApiError,
  MAX_REQUEST_TIMEOUT_RETRIES,
  MAX_SEARCH_PAGE_SIZE,
  NodeInputError,
  normalizeApiUrl,
  normalizeDocumentResponse,
  parseStringArray,
  REQUEST_TIMEOUT_RETRY_BASE_DELAY_MS,
  retryOnRequestTimeout,
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
      NodeInputError,
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
        limit: 30,
      },
      true,
    );

    expect(request.qs.q).toBeUndefined();
    expect(request.qs.limit).toBe(30);
    expect(request.qs.ai_mode).toBe('on-default');
    expect(JSON.parse(String(request.qs.filters))).toEqual({
      postal_code: '80331',
    });
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
      location_coordinates: { latitude: 48.137, longitude: 11.575 },
      location_max_distance_km: 25,
      emp_count: { gte: 50, lte: 249 },
      bs_assets_total: { gte: 1_000_000 },
      bs_equity_ratio: { lte: 0.8 },
      pl_ebit: { gte: 50_000 },
    });
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

    await expect(retryOnRequestTimeout(request, sleep)).resolves.toEqual({ ok: true });
    expect(MAX_REQUEST_TIMEOUT_RETRIES).toBe(3);
    expect(request).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      REQUEST_TIMEOUT_RETRY_BASE_DELAY_MS,
      REQUEST_TIMEOUT_RETRY_BASE_DELAY_MS * 2,
      REQUEST_TIMEOUT_RETRY_BASE_DELAY_MS * 4,
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

    await expect(retryOnRequestTimeout(request, sleep)).rejects.toBe(timeout);
    expect(request).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('does not retry failures other than HTTP 408', async () => {
    const failure = Object.assign(new Error('Service unavailable'), {
      response: { statusCode: 503 },
    });
    const request = vi.fn(async () => {
      throw failure;
    });
    const sleep = vi.fn(async () => undefined);

    await expect(retryOnRequestTimeout(request, sleep)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
