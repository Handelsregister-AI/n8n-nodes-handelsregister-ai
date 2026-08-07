import {
  type IDataObject,
  type IExecuteFunctions,
  type IHttpRequestOptions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type JsonObject,
  NodeApiError,
  NodeConnectionTypes,
  NodeOperationError,
  UserError,
} from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import {
  buildOrganizationQuery,
  buildSearchRequest,
  buildSignalsQuery,
  extractApiError,
  MAX_SEARCH_PAGE_SIZE,
  normalizeApiUrl,
  normalizeDocumentResponse,
  retryTransientRequest,
  SIGNALS_PAGE_SIZE,
  type DocumentType,
  type SearchAdditionalFields,
  validatePersonQuery,
} from './utils';

interface SearchApiResponse extends IDataObject {
  results: IDataObject[];
  total: number;
  meta?: IDataObject;
}

interface SignalsApiResponse {
  signals: IDataObject[];
  pagination: IDataObject;
  filters?: IDataObject;
  warnings?: unknown[];
  meta?: IDataObject;
}

function validateSearchResponse(value: unknown): SearchApiResponse {
  if (!value || typeof value !== 'object') {
    throw new UserError('The API returned an invalid search response');
  }
  const response = value as Record<string, unknown>;
  if (!Array.isArray(response.results) || typeof response.total !== 'number') {
    throw new UserError('The API search response is missing results or total');
  }
  return response as SearchApiResponse;
}

function validateSignalsResponse(value: unknown): SignalsApiResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UserError('The API returned an invalid Signals response');
  }
  const response = value as Record<string, unknown>;
  if (
    !Array.isArray(response.signals) ||
    !response.pagination ||
    typeof response.pagination !== 'object' ||
    Array.isArray(response.pagination)
  ) {
    throw new UserError('The API Signals response is missing signals or pagination');
  }
  if (
    response.signals.some(
      (signal) => !signal || typeof signal !== 'object' || Array.isArray(signal),
    )
  ) {
    throw new UserError('The API Signals response contains an invalid Signal');
  }
  return response as unknown as SignalsApiResponse;
}

function numberParameter(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new UserError(`${label} must be a non-negative integer`);
  }
  return number;
}

export class HandelsregisterAi implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'handelsregister.ai',
    name: 'handelsregisterAi',
    icon: {
      light: 'file:../../icons/handelsregister_ai.svg',
      dark: 'file:../../icons/handelsregister_ai.dark.svg',
    },
    group: ['transform'],
    version: 1,
    description: 'Query German business registry data through the handelsregister.ai API',
    subtitle: '={{$parameter["operation"]}}',
    defaults: {
      name: 'handelsregister.ai',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [
      {
        name: 'handelsregisterAiApi',
        required: true,
      },
    ],
    properties: nodeProperties,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('handelsregisterAiApi');
    const apiUrl = normalizeApiUrl(credentials.apiUrl);

    const request = async (options: IHttpRequestOptions): Promise<unknown> => {
      const executeRequest = async () =>
        await this.helpers.httpRequestWithAuthentication.call(
          this,
          'handelsregisterAiApi',
          options,
        );
      if ((options.method ?? 'GET') !== 'GET') return await executeRequest();
      return await retryTransientRequest(executeRequest);
    };

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter('operation', i) as string;

        if (operation === 'fetchOrganization') {
          const query = this.getNodeParameter('q', i) as string;
          const features = this.getNodeParameter('features', i, []) as string[];
          const aiSearch = this.getNodeParameter('ai_search', i, true) as boolean;
          const realtimeMode = this.getNodeParameter('realtime_mode', i, false) as boolean;
          const queryString = buildOrganizationQuery(query, features, aiSearch, realtimeMode);

          const responseData = await request({
            method: 'GET',
            url: `${apiUrl}/api/v1/fetch-organization?${queryString}`,
            json: true,
          });
          returnData.push({
            json: responseData as IDataObject,
            pairedItem: { item: i },
          });
          continue;
        }

        if (operation === 'searchOrganizations') {
          const query = this.getNodeParameter('q', i, '') as string;
          const additionalFields = this.getNodeParameter(
            'additionalFields',
            i,
            {},
          ) as SearchAdditionalFields;
          const aiMode = this.getNodeParameter('searchAiMode', i, false) as boolean;
          const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
          const maxResults = returnAll
            ? numberParameter(this.getNodeParameter('maxResults', i, 0), 'Maximum Results')
            : 0;
          const outputMode = this.getNodeParameter('searchOutput', i, 'split') as
            'split' | 'response';

          const initialRequest = buildSearchRequest(
            query,
            additionalFields,
            aiMode,
            returnAll ? { limit: MAX_SEARCH_PAGE_SIZE } : {},
          );

          let skip = initialRequest.skip;
          let total = 0;
          let requestCreditCost = 0;
          let lastMeta: IDataObject = {};
          const results: IDataObject[] = [];
          let fetchNextPage = true;

          while (fetchNextPage) {
            const pageRequest = buildSearchRequest(query, additionalFields, aiMode, {
              skip,
              limit: returnAll ? MAX_SEARCH_PAGE_SIZE : initialRequest.limit,
            });
            const page = validateSearchResponse(
              await request({
                method: 'GET',
                url: `${apiUrl}/api/v1/search-organizations`,
                qs: pageRequest.qs,
                json: true,
              }),
            );

            total = page.total;
            lastMeta = page.meta ?? {};
            const pageCreditCost = Number(page.meta?.request_credit_cost ?? 0);
            if (Number.isFinite(pageCreditCost)) requestCreditCost += pageCreditCost;

            const remaining =
              maxResults > 0 ? Math.max(0, maxResults - results.length) : page.results.length;
            results.push(...page.results.slice(0, remaining));

            fetchNextPage =
              returnAll &&
              page.results.length > 0 &&
              results.length < total &&
              (maxResults === 0 || results.length < maxResults);
            if (fetchNextPage) skip += page.results.length;
          }

          const meta: IDataObject = {
            ...lastMeta,
            request_credit_cost: requestCreditCost,
          };
          const completeResponse: SearchApiResponse = { results, total, meta };

          if (outputMode === 'response') {
            returnData.push({
              json: completeResponse,
              pairedItem: { item: i },
            });
          } else {
            returnData.push(
              ...results.map((item) => ({
                json: {
                  ...item,
                  _meta: {
                    total,
                    request_credit_cost: requestCreditCost,
                    credits_remaining: meta.credits_remaining,
                  },
                },
                pairedItem: { item: i },
              })),
            );
          }
          continue;
        }

        if (operation === 'fetchDocument') {
          const companyId = String(this.getNodeParameter('company_id', i)).trim();
          if (!companyId) throw new UserError('Company ID is required');
          const documentType = this.getNodeParameter('document_type', i) as DocumentType;

          const response = await request({
            method: 'GET',
            url: `${apiUrl}/api/v1/fetch-document`,
            qs: {
              company_id: companyId,
              document_type: documentType,
            },
            encoding: 'arraybuffer',
            json: false,
            returnFullResponse: true,
          });
          const document = normalizeDocumentResponse(response, companyId, documentType);
          const binaryData = await this.helpers.prepareBinaryData(
            document.buffer,
            document.fileName,
            document.mimeType,
          );

          returnData.push({
            json: {
              company_id: companyId,
              document_type: documentType,
              file_name: document.fileName,
              mime_type: document.mimeType,
            },
            binary: { data: binaryData },
            pairedItem: { item: i },
          });
          continue;
        }

        if (operation === 'fetchPerson') {
          const personQ = this.getNodeParameter('person_q', i) as string;
          const organizationQ = this.getNodeParameter('organization_q', i) as string;
          const personFeatures = this.getNodeParameter('personFeatures', i, []) as string[];
          validatePersonQuery(personQ, organizationQ);

          const queryParams = new URLSearchParams({
            person_q: personQ.trim(),
            organization_q: organizationQ.trim(),
          });
          for (const feature of personFeatures) queryParams.append('feature', feature);

          const responseData = await request({
            method: 'GET',
            url: `${apiUrl}/api/v1/fetch-person?${queryParams.toString()}`,
            json: true,
          });
          returnData.push({
            json: responseData as IDataObject,
            pairedItem: { item: i },
          });
          continue;
        }

        if (operation === 'getSignalCatalog') {
          const responseData = await request({
            method: 'GET',
            url: `${apiUrl}/api/v1/signals/catalog`,
            json: true,
          });
          returnData.push({
            json: responseData as IDataObject,
            pairedItem: { item: i },
          });
          continue;
        }

        if (operation === 'getSignal') {
          const signalId = String(this.getNodeParameter('signalId', i)).trim();
          if (!signalId) throw new UserError('Signal ID is required');
          const responseData = await request({
            method: 'GET',
            url: `${apiUrl}/api/v1/signals/${encodeURIComponent(signalId)}`,
            json: true,
          });
          returnData.push({
            json: responseData as IDataObject,
            pairedItem: { item: i },
          });
          continue;
        }

        if (operation === 'listSignals') {
          const topics = this.getNodeParameter('signalTopics', i, []) as string[];
          const organizationIds = this.getNodeParameter('signalOrganizationIds', i, '') as string;
          const fromDate = this.getNodeParameter('signalFrom', i, '') as string;
          const toDate = this.getNodeParameter('signalTo', i, '') as string;
          const returnAll = this.getNodeParameter('signalsReturnAll', i, false) as boolean;
          const maxResults = returnAll
            ? numberParameter(this.getNodeParameter('signalsMaxResults', i, 0), 'Maximum Results')
            : 0;
          const outputMode = this.getNodeParameter('signalsOutput', i, 'split') as
            'split' | 'response';
          const manualCursor = returnAll
            ? ''
            : String(this.getNodeParameter('signalCursor', i, '')).trim();

          let cursor = manualCursor || undefined;
          const seenCursors = new Set<string>();
          if (cursor) seenCursors.add(cursor);
          const signals: IDataObject[] = [];
          const warnings: unknown[] = [];
          let filters: IDataObject = {};
          let lastPage: SignalsApiResponse | undefined;
          let requestCreditCost = 0;
          let pagesFetched = 0;
          let truncated = false;

          while (true) {
            const page = validateSignalsResponse(
              await request({
                method: 'GET',
                url: `${apiUrl}/api/v1/signals`,
                qs: buildSignalsQuery({
                  topics,
                  organizationIds,
                  fromDate,
                  toDate,
                  cursor,
                }),
                json: true,
              }),
            );
            lastPage = page;
            pagesFetched += 1;
            if (pagesFetched === 1) filters = page.filters ?? {};
            if (Array.isArray(page.warnings)) warnings.push(...page.warnings);
            const pageCreditCost = Number(page.meta?.request_credit_cost ?? 0);
            if (Number.isFinite(pageCreditCost)) requestCreditCost += pageCreditCost;

            const remaining = maxResults > 0 ? Math.max(0, maxResults - signals.length) : Infinity;
            signals.push(...page.signals.slice(0, remaining));

            const hasMore = page.pagination.has_more === true;
            const nextCursor =
              typeof page.pagination.next_cursor === 'string' && page.pagination.next_cursor.trim()
                ? page.pagination.next_cursor
                : undefined;
            const reachedMaximum = maxResults > 0 && signals.length >= maxResults;
            if (!returnAll) break;
            if (reachedMaximum) {
              truncated = hasMore || page.signals.length > remaining;
              break;
            }
            if (!hasMore || !nextCursor) break;
            if (seenCursors.has(nextCursor)) {
              throw new UserError('The API repeated a Signals pagination cursor');
            }
            seenCursors.add(nextCursor);
            cursor = nextCursor;
          }

          if (!lastPage) throw new UserError('The API returned no Signals page');
          const meta: IDataObject = {
            ...(lastPage.meta ?? {}),
            request_credit_cost: requestCreditCost,
          };
          const pagination: IDataObject = returnAll
            ? {
                mode: lastPage.pagination.mode ?? 'CURSOR',
                limit: SIGNALS_PAGE_SIZE,
                returned: signals.length,
                has_more: false,
                next_cursor: null,
                pages_fetched: pagesFetched,
                ...(truncated ? { truncated: true } : {}),
              }
            : lastPage.pagination;
          const completeResponse = {
            signals,
            pagination,
            filters,
            warnings,
            meta,
          } as unknown as IDataObject;

          if (outputMode === 'response') {
            returnData.push({
              json: completeResponse,
              pairedItem: { item: i },
            });
          } else {
            returnData.push(
              ...signals.map((signal) => ({
                json: {
                  ...signal,
                  _meta: {
                    request_credit_cost: requestCreditCost,
                    credits_remaining: meta.credits_remaining,
                    pages_fetched: pagesFetched,
                    ...(truncated ? { truncated: true } : {}),
                  },
                },
                pairedItem: { item: i },
              })),
            );
          }
          continue;
        }

        throw new UserError(`Unsupported operation: ${operation}`);
      } catch (error) {
        const apiError = extractApiError(error);
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              error: apiError.message,
              ...(apiError.statusCode !== undefined ? { status_code: apiError.statusCode } : {}),
              ...(apiError.code ? { code: apiError.code } : {}),
              ...(apiError.detail !== undefined ? { detail: apiError.detail } : {}),
              ...(apiError.meta !== undefined ? { meta: apiError.meta } : {}),
            } as IDataObject,
            pairedItem: { item: i },
          });
          continue;
        }
        if (error instanceof UserError || error instanceof NodeOperationError) {
          throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
        }
        throw new NodeApiError(this.getNode(), error as JsonObject, {
          itemIndex: i,
          message: apiError.message,
          httpCode: apiError.statusCode ? String(apiError.statusCode) : undefined,
        });
      }
    }

    return [returnData];
  }
}
