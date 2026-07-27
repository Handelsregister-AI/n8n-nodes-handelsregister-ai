import type { IDataObject } from 'n8n-workflow';

export const MAX_SEARCH_PAGE_SIZE = 30;
export const MAX_REQUEST_TIMEOUT_RETRIES = 3;
export const REQUEST_TIMEOUT_RETRY_BASE_DELAY_MS = 500;

export const DOCUMENT_TYPES = [
  'shareholders_list',
  'articles_of_association',
  'AD',
  'CD',
  'SI',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const RANGE_FILTERS = [
  'emp_count',
  'bs_assets_total',
  'bs_equity_total',
  'bs_liabilities_total',
  'bs_cash_and_equivalents',
  'bs_cash_to_liabilities',
  'bs_equity_ratio',
  'bs_debt_to_assets',
  'pl_revenue',
  'pl_net_income',
  'pl_ebit',
] as const;

const ARRAY_FILTERS = ['legal_form_code', 'industry_code', 'registration_type'] as const;

const SCALAR_FILTERS = [
  'registration_date_from',
  'registration_date_to',
  'industry_scheme',
  'postal_code',
  'city',
  'state',
  'registration_authority_name',
  'registration_number',
  'company_size_category',
] as const;

const RATIO_FILTERS = new Set(['bs_cash_to_liabilities', 'bs_equity_ratio', 'bs_debt_to_assets']);

export class NodeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeInputError';
  }
}

export interface SearchAdditionalFields {
  skip?: number;
  limit?: number;
  filtersJson?: string | IDataObject;
  active?: '' | 'true' | 'false';
  latitude?: number;
  longitude?: number;
  location_max_distance_km?: number;
  [key: string]: unknown;
}

export interface SearchRequest {
  qs: IDataObject;
  skip: number;
  limit: number;
  filters: IDataObject;
}

export function normalizeApiUrl(value: unknown): string {
  const url = String(value || 'https://handelsregister.ai').trim();
  return url.replace(/\/+$/, '');
}

export function parseStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseFiltersJson(value: unknown): IDataObject {
  if (value === undefined || value === null || value === '') return {};

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new NodeInputError('Advanced Filters JSON must contain valid JSON');
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NodeInputError('Advanced Filters JSON must be a JSON object');
  }

  return { ...(parsed as IDataObject) };
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new NodeInputError(`${label} must be a finite number`);
  }
  return number;
}

function optionalInteger(value: unknown, label: string): number | undefined {
  const number = optionalNumber(value, label);
  if (number !== undefined && !Number.isInteger(number)) {
    throw new NodeInputError(`${label} must be an integer`);
  }
  return number;
}

function validateRange(name: string, gte: number | undefined, lte: number | undefined): void {
  if (gte !== undefined && lte !== undefined && gte > lte) {
    throw new NodeInputError(`${name} minimum cannot be greater than its maximum`);
  }
  if (RATIO_FILTERS.has(name)) {
    for (const value of [gte, lte]) {
      if (value !== undefined && (value < 0 || value > 1)) {
        throw new NodeInputError(`${name} values must be between 0 and 1`);
      }
    }
  }
}

export function buildSearchFilters(fields: SearchAdditionalFields): IDataObject {
  const filters = parseFiltersJson(fields.filtersJson);

  for (const name of SCALAR_FILTERS) {
    const value = fields[name];
    if (typeof value === 'string' && value.trim() !== '') {
      filters[name] = value.trim();
    }
  }

  for (const name of ARRAY_FILTERS) {
    const value = parseStringArray(fields[name]);
    if (value) filters[name] = value;
  }

  if (fields.active === 'true') filters.active = true;
  if (fields.active === 'false') filters.active = false;

  const latitude = optionalNumber(fields.latitude, 'Latitude');
  const longitude = optionalNumber(fields.longitude, 'Longitude');
  const maxDistance = optionalNumber(fields.location_max_distance_km, 'Location Maximum Distance');

  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new NodeInputError('Latitude and longitude must be provided together');
  }
  if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
    throw new NodeInputError('Latitude must be between -90 and 90');
  }
  if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
    throw new NodeInputError('Longitude must be between -180 and 180');
  }
  if (maxDistance !== undefined && (maxDistance < 1 || maxDistance > 100)) {
    throw new NodeInputError('Location Maximum Distance must be between 1 and 100 km');
  }
  if (maxDistance !== undefined && latitude === undefined) {
    throw new NodeInputError('Location Maximum Distance requires latitude and longitude');
  }
  if (latitude !== undefined && longitude !== undefined) {
    filters.location_coordinates = { latitude, longitude };
  }
  if (maxDistance !== undefined) {
    filters.location_max_distance_km = maxDistance;
  }

  for (const name of RANGE_FILTERS) {
    const gte = optionalNumber(fields[`${name}_gte`], `${name} minimum`);
    const lte = optionalNumber(fields[`${name}_lte`], `${name} maximum`);
    validateRange(name, gte, lte);
    if (gte !== undefined || lte !== undefined) {
      filters[name] = {
        ...(gte !== undefined ? { gte } : {}),
        ...(lte !== undefined ? { lte } : {}),
      };
    }
  }

  return filters;
}

export function buildSearchRequest(
  queryValue: unknown,
  fields: SearchAdditionalFields,
  aiMode: boolean,
  overrides: { skip?: number; limit?: number } = {},
): SearchRequest {
  const q = String(queryValue || '').trim();
  if (q && q.length < 2) {
    throw new NodeInputError('Search query must be at least 2 characters');
  }

  const filters = buildSearchFilters(fields);
  if (!q && Object.keys(filters).length === 0) {
    throw new NodeInputError('Enter a search query or configure at least one filter');
  }

  const skip = overrides.skip ?? optionalInteger(fields.skip, 'Skip') ?? 0;
  const limit = overrides.limit ?? optionalInteger(fields.limit, 'Limit') ?? 10;
  if (skip < 0) throw new NodeInputError('Skip must be greater than or equal to 0');
  if (limit < 1 || limit > MAX_SEARCH_PAGE_SIZE) {
    throw new NodeInputError(`Limit must be between 1 and ${MAX_SEARCH_PAGE_SIZE}`);
  }

  const qs: IDataObject = { skip, limit };
  if (q) qs.q = q;
  if (Object.keys(filters).length > 0) qs.filters = JSON.stringify(filters);
  if (aiMode) qs.ai_mode = 'on-default';

  return { qs, skip, limit, filters };
}

export function buildOrganizationQuery(
  queryValue: unknown,
  features: string[],
  aiSearch: boolean,
  realtimeMode: boolean,
): string {
  const query = String(queryValue || '').trim();
  if (!query) throw new NodeInputError('Organization query is required');

  if (realtimeMode && (features.includes('related_persons') || features.includes('publications'))) {
    throw new NodeInputError(
      'Realtime Mode cannot be combined with Related Persons or Publications',
    );
  }

  const queryParams = new URLSearchParams({ q: query });
  for (const feature of features) queryParams.append('feature', feature);
  if (aiSearch) queryParams.append('ai_search', 'on-default');
  if (realtimeMode) {
    queryParams.append('realtime_mode', 'handelsregister-default');
  }
  return queryParams.toString();
}

export function validatePersonQuery(personValue: unknown, organizationValue: unknown): void {
  const person = String(personValue || '').trim();
  const organization = String(organizationValue || '').trim();
  if (person.length < 2) throw new NodeInputError('Person name must be at least 2 characters');
  if (organization.length < 2) {
    throw new NodeInputError('Organization context must be at least 2 characters');
  }
}

function getHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

function filenameFromDisposition(disposition: string | undefined): string | undefined {
  if (!disposition) return undefined;
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      return utf8[1].trim();
    }
  }
  const quoted = disposition.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = disposition.match(/filename=([^;]+)/i);
  return plain?.[1]?.trim();
}

export interface DocumentResponse {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export function normalizeDocumentResponse(
  response: unknown,
  companyId: string,
  documentType: DocumentType,
): DocumentResponse {
  const fullResponse =
    response && typeof response === 'object' && 'body' in response
      ? (response as { body: unknown; headers?: unknown })
      : { body: response, headers: undefined };

  const body = fullResponse.body;
  const buffer = Buffer.isBuffer(body)
    ? body
    : body instanceof ArrayBuffer
      ? Buffer.from(body)
      : ArrayBuffer.isView(body)
        ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
        : Buffer.from(body as string | Uint8Array);

  const defaultMime = documentType === 'SI' ? 'application/xml' : 'application/pdf';
  const mimeType =
    getHeader(fullResponse.headers, 'content-type')?.split(';')[0]?.trim() || defaultMime;
  const extension = mimeType.includes('xml') || documentType === 'SI' ? 'xml' : 'pdf';
  const serverFileName = filenameFromDisposition(
    getHeader(fullResponse.headers, 'content-disposition'),
  );

  return {
    buffer,
    mimeType,
    fileName: serverFileName || `${companyId}_${documentType}.${extension}`,
  };
}

export interface ApiErrorInfo {
  message: string;
  statusCode?: number;
  code?: string;
  detail?: unknown;
  meta?: unknown;
}

export function extractApiError(error: unknown): ApiErrorInfo {
  const fallback = error instanceof Error ? error.message : String(error);
  if (!error || typeof error !== 'object') return { message: fallback };

  const candidate = error as Record<string, unknown>;
  const response =
    candidate.response && typeof candidate.response === 'object'
      ? (candidate.response as Record<string, unknown>)
      : undefined;
  const bodyValue = response?.body ?? response?.data ?? candidate.body;
  const body =
    bodyValue && typeof bodyValue === 'object' ? (bodyValue as Record<string, unknown>) : undefined;

  const meta =
    body?.meta && typeof body.meta === 'object'
      ? (body.meta as Record<string, unknown>)
      : undefined;
  const detail = body?.detail;
  const firstDetail =
    Array.isArray(detail) && detail[0] && typeof detail[0] === 'object'
      ? (detail[0] as Record<string, unknown>)
      : undefined;
  const message =
    (typeof body?.error === 'string' && body.error) ||
    (typeof meta?.message === 'string' && meta.message) ||
    (typeof firstDetail?.msg === 'string' && firstDetail.msg) ||
    fallback;
  const rawStatus =
    response?.statusCode ?? response?.status ?? candidate.statusCode ?? candidate.httpCode;
  const statusCode =
    typeof rawStatus === 'number'
      ? rawStatus
      : typeof rawStatus === 'string' && /^\d+$/.test(rawStatus)
        ? Number(rawStatus)
        : undefined;

  return {
    message,
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(typeof body?.error === 'string' ? { code: body.error } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(body?.meta !== undefined ? { meta: body.meta } : {}),
  };
}

type Sleep = (delayMs: number) => Promise<void>;

const defaultSleep: Sleep = async (delayMs) =>
  await new Promise((resolve) => setTimeout(resolve, delayMs));

export async function retryOnRequestTimeout<T>(
  request: () => Promise<T>,
  sleep: Sleep = defaultSleep,
): Promise<T> {
  let retries = 0;

  while (true) {
    try {
      return await request();
    } catch (error) {
      if (extractApiError(error).statusCode !== 408 || retries >= MAX_REQUEST_TIMEOUT_RETRIES) {
        throw error;
      }

      const delayMs = REQUEST_TIMEOUT_RETRY_BASE_DELAY_MS * 2 ** retries;
      retries += 1;
      await sleep(delayMs);
    }
  }
}
