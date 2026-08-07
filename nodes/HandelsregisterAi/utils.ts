import { type IDataObject, sleep, UserError } from 'n8n-workflow';

export const MAX_SEARCH_PAGE_SIZE = 30;
export const SIGNALS_PAGE_SIZE = 20;
export const MAX_TRANSIENT_REQUEST_RETRIES = 3;
export const TRANSIENT_RETRY_BASE_DELAY_MS = 1_000;
export const MAX_RETRY_AFTER_DELAY_MS = 60_000;

/** @deprecated Use MAX_TRANSIENT_REQUEST_RETRIES. */
export const MAX_REQUEST_TIMEOUT_RETRIES = MAX_TRANSIENT_REQUEST_RETRIES;
/** @deprecated Use TRANSIENT_RETRY_BASE_DELAY_MS. */
export const REQUEST_TIMEOUT_RETRY_BASE_DELAY_MS = TRANSIENT_RETRY_BASE_DELAY_MS;

export const SIGNAL_TOPICS = [
  'NEW_REGISTRATIONS',
  'MASTER_DATA_CHANGES',
  'CLOSURES',
  'ROLE_HOLDER_CHANGES',
  'CAPITAL_CHANGES',
  'INSOLVENCIES',
  'TRANSFORMATIONS',
] as const;

export type SignalTopic = (typeof SIGNAL_TOPICS)[number];

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
] as const;

const RATIO_FILTERS = new Set(['bs_cash_to_liabilities', 'bs_equity_ratio', 'bs_debt_to_assets']);

export interface SearchAdditionalFields {
  skip?: number;
  limit?: number;
  pageSize?: number;
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

export interface SignalsListFields {
  topics?: string[] | string;
  organizationIds?: string[] | string;
  fromDate?: string;
  toDate?: string;
  cursor?: string;
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
  let parseFailed = false;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parseFailed = true;
    }
  }

  if (parseFailed) throw new UserError('Advanced Filters JSON must contain valid JSON');

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UserError('Advanced Filters JSON must be a JSON object');
  }

  return { ...(parsed as IDataObject) };
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new UserError(`${label} must be a finite number`);
  }
  return number;
}

function optionalInteger(value: unknown, label: string): number | undefined {
  const number = optionalNumber(value, label);
  if (number !== undefined && !Number.isInteger(number)) {
    throw new UserError(`${label} must be an integer`);
  }
  return number;
}

function validateRange(name: string, gte: number | undefined, lte: number | undefined): void {
  if (gte !== undefined && lte !== undefined && gte > lte) {
    throw new UserError(`${name} minimum cannot be greater than its maximum`);
  }
  if (RATIO_FILTERS.has(name)) {
    for (const value of [gte, lte]) {
      if (value !== undefined && (value < 0 || value > 1)) {
        throw new UserError(`${name} values must be between 0 and 1`);
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

  if (
    typeof fields.company_size_category === 'string' &&
    fields.company_size_category.trim() !== ''
  ) {
    filters.emp_size_category = fields.company_size_category.trim();
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
    throw new UserError('Latitude and longitude must be provided together');
  }
  if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
    throw new UserError('Latitude must be between -90 and 90');
  }
  if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
    throw new UserError('Longitude must be between -180 and 180');
  }
  if (maxDistance !== undefined && (maxDistance < 1 || maxDistance > 100)) {
    throw new UserError('Location Maximum Distance must be between 1 and 100 km');
  }
  if (maxDistance !== undefined && latitude === undefined) {
    throw new UserError('Location Maximum Distance requires latitude and longitude');
  }
  if (latitude !== undefined && longitude !== undefined) {
    filters.location_coordinates = { latitude, longitude };
  }
  if (maxDistance !== undefined) {
    filters.location_max_distance_km = maxDistance;
  }

  const financialFilters: IDataObject = {};
  for (const name of RANGE_FILTERS) {
    const gte = optionalNumber(fields[`${name}_gte`], `${name} minimum`);
    const lte = optionalNumber(fields[`${name}_lte`], `${name} maximum`);
    validateRange(name, gte, lte);
    if (gte !== undefined || lte !== undefined) {
      financialFilters[name] = {
        ...(gte !== undefined ? { gte } : {}),
        ...(lte !== undefined ? { lte } : {}),
      };
    }
  }
  if (Object.keys(financialFilters).length > 0) {
    filters.financial_filters = financialFilters;
  }

  return filters;
}

function normalizeSignalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  if (!text || Number.isNaN(Date.parse(text))) {
    throw new UserError(`${label} must be an ISO 8601 date or date-time`);
  }
  return text;
}

export function buildSignalsQuery(fields: SignalsListFields): IDataObject {
  const qs: IDataObject = {};

  const topics = [...new Set(parseStringArray(fields.topics) ?? [])];
  const unsupportedTopics = topics.filter(
    (topic) => !(SIGNAL_TOPICS as readonly string[]).includes(topic),
  );
  if (unsupportedTopics.length > 0) {
    throw new UserError(
      `Unsupported signal topics: ${unsupportedTopics.join(', ')}. Valid values are: ${SIGNAL_TOPICS.join(', ')}`,
    );
  }
  if (topics.length > 0) qs.topics = topics.join(',');

  const organizationIds = [...new Set(parseStringArray(fields.organizationIds) ?? [])];
  if (organizationIds.length > 0) qs.organization_ids = organizationIds.join(',');

  const fromDate = normalizeSignalDate(fields.fromDate, 'From');
  const toDate = normalizeSignalDate(fields.toDate, 'To');
  if (fromDate) qs.from = fromDate;
  if (toDate) qs.to = toDate;

  if (fields.cursor !== undefined) {
    const cursor = String(fields.cursor).trim();
    if (!cursor) throw new UserError('Cursor must not be empty');
    qs.cursor = cursor;
  }

  return qs;
}

export function buildSearchRequest(
  queryValue: unknown,
  fields: SearchAdditionalFields,
  aiMode: boolean,
  overrides: { skip?: number; limit?: number } = {},
): SearchRequest {
  const q = String(queryValue || '').trim();
  if (q && q.length < 2) {
    throw new UserError('Search query must be at least 2 characters');
  }

  const filters = buildSearchFilters(fields);
  if (!q && Object.keys(filters).length === 0) {
    throw new UserError('Enter a search query or configure at least one filter');
  }

  const skip = overrides.skip ?? optionalInteger(fields.skip, 'Skip') ?? 0;
  const limit =
    overrides.limit ?? optionalInteger(fields.pageSize ?? fields.limit, 'Page Size') ?? 10;
  if (skip < 0) throw new UserError('Skip must be greater than or equal to 0');
  if (limit < 1 || limit > MAX_SEARCH_PAGE_SIZE) {
    throw new UserError(`Page Size must be between 1 and ${MAX_SEARCH_PAGE_SIZE}`);
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
  if (!query) throw new UserError('Organization query is required');

  if (realtimeMode && (features.includes('related_persons') || features.includes('publications'))) {
    throw new UserError('Realtime Mode cannot be combined with Related Persons or Publications');
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
  if (person.length < 2) throw new UserError('Person name must be at least 2 characters');
  if (organization.length < 2) {
    throw new UserError('Organization context must be at least 2 characters');
  }
}

function getHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown>;
  const getter = record.get;
  if (typeof getter === 'function') {
    const value = getter.call(headers, name);
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }

  const lowerName = name.toLowerCase();
  const matchingEntry = Object.entries(record).find(([key]) => key.toLowerCase() === lowerName);
  const value = matchingEntry?.[1];
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

const defaultSleep: Sleep = sleep;

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_NETWORK',
  'ESOCKETTIMEDOUT',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function errorCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 3; depth++) {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const record = candidate as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code.toUpperCase();
    candidate = record.cause;
  }
  return undefined;
}

export function isRetryableRequestError(error: unknown): boolean {
  const statusCode = extractApiError(error).statusCode;
  if (statusCode !== undefined) {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  }

  const code = errorCode(error);
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  if (error instanceof Error) {
    return error.name === 'RequestError' || error.name === 'TimeoutError';
  }
  return false;
}

export function retryDelayMs(
  error: unknown,
  fallbackDelayMs: number,
  nowMs: number = Date.now(),
): number {
  if (!error || typeof error !== 'object') return fallbackDelayMs;
  const candidate = error as Record<string, unknown>;
  const response =
    candidate.response && typeof candidate.response === 'object'
      ? (candidate.response as Record<string, unknown>)
      : undefined;
  const retryAfter = getHeader(response?.headers ?? candidate.headers, 'retry-after')?.trim();
  if (!retryAfter) return fallbackDelayMs;

  const seconds = Number(retryAfter);
  const requestedDelayMs = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(retryAfter) - nowMs;
  if (!Number.isFinite(requestedDelayMs)) return fallbackDelayMs;
  return Math.min(MAX_RETRY_AFTER_DELAY_MS, Math.max(0, requestedDelayMs));
}

export async function retryTransientRequest<T>(
  request: () => Promise<T>,
  sleepFn: Sleep = defaultSleep,
): Promise<T> {
  let retries = 0;

  while (true) {
    let caughtError: unknown;
    try {
      return await request();
    } catch (error) {
      caughtError = error;
    }

    if (!isRetryableRequestError(caughtError) || retries >= MAX_TRANSIENT_REQUEST_RETRIES) {
      throw caughtError;
    }

    const fallbackDelayMs = TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** retries;
    const delayMs = retryDelayMs(caughtError, fallbackDelayMs);
    retries += 1;
    await sleepFn(delayMs);
  }
}

/** @deprecated Use retryTransientRequest. */
export const retryOnRequestTimeout = retryTransientRequest;
