import {
  type IDataObject,
  type IExecuteFunctions,
  type IHttpRequestOptions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type JsonObject,
  NodeApiError,
  NodeOperationError,
} from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import {
  buildOrganizationQuery,
  buildSearchRequest,
  extractApiError,
  MAX_SEARCH_PAGE_SIZE,
  NodeInputError,
  normalizeApiUrl,
  normalizeDocumentResponse,
  retryOnRequestTimeout,
  type DocumentType,
  type SearchAdditionalFields,
  validatePersonQuery,
} from './utils';

interface SearchApiResponse extends IDataObject {
  results: IDataObject[];
  total: number;
  meta?: IDataObject;
}

function validateSearchResponse(value: unknown): SearchApiResponse {
  if (!value || typeof value !== 'object') {
    throw new NodeInputError('The API returned an invalid search response');
  }
  const response = value as Record<string, unknown>;
  if (!Array.isArray(response.results) || typeof response.total !== 'number') {
    throw new NodeInputError('The API search response is missing results or total');
  }
  return response as SearchApiResponse;
}

function numberParameter(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new NodeInputError(`${label} must be a non-negative integer`);
  }
  return number;
}

export class HandelsregisterAi implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'handelsregister.ai',
    name: 'handelsregisterAi',
    icon: 'file:handelsregister_ai_icon.png',
    group: ['transform'],
    version: 1,
    description: 'Query German business registry data through the handelsregister.ai API',
    defaults: {
      name: 'handelsregister.ai',
    },
    inputs: ['main'],
    outputs: ['main'],
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

    const request = async (options: IHttpRequestOptions): Promise<unknown> =>
      await retryOnRequestTimeout(async () =>
        this.helpers.httpRequestWithAuthentication.call(this, 'handelsregisterAiApi', options),
      );

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
          if (!companyId) throw new NodeInputError('Company ID is required');
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

        throw new NodeInputError(`Unsupported operation: ${operation}`);
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
        if (error instanceof NodeInputError) {
          throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
        }
        if (error instanceof NodeOperationError || error instanceof NodeApiError) {
          throw error;
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
