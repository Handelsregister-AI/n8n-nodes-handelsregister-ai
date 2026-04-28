import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
  NodeConnectionType,
  IHttpRequestOptions,
} from 'n8n-workflow';

interface SearchResultItem {
  entity_id: string;
  name: string;
  registration?: {
    court: string;
    register_type: string;
    register_number: string;
  };
  address?: {
    street: string;
    city: string;
    postal_code: string;
    [key: string]: string | number | undefined;
  };
  [key: string]: unknown;
}

export class HandelsregisterAi implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'handelsregister.ai',
    name: 'handelsregisterAi',
    icon: 'file:handelsregister_ai_icon.png',
    group: ['transform'],
    version: 1,
    description: 'Interact with handelsregister.ai API to query German business registry data',
    defaults: {
      name: 'handelsregister.ai',
    },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    credentials: [
      {
        name: 'handelsregisterAiApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Fetch Organization',
            value: 'fetchOrganization',
            description: 'Get comprehensive information about a German company',
            action: 'Fetch organization details',
          },
          {
            name: 'Search Organizations',
            value: 'searchOrganizations',
            description: 'Search German companies with filters and pagination',
            action: 'Search organizations',
          },
          {
            name: 'Fetch Document',
            value: 'fetchDocument',
            description: 'Download official PDF documents from the German business registry',
            action: 'Fetch document',
          },
          {
            name: 'Fetch Person',
            value: 'fetchPerson',
            description:
              'Fetch a person profile by name and company context (always uses AI enrichment)',
            action: 'Fetch person details',
          },
        ],
        default: 'fetchOrganization',
      },
      // Fetch Organization fields
      {
        displayName: 'Query',
        name: 'q',
        type: 'string',
        default: '',
        placeholder: 'e.g., Konux GmbH aus München',
        description: 'Company name, registration number or search query',
        displayOptions: {
          show: {
            operation: ['fetchOrganization'],
          },
        },
        required: true,
      },
      {
        displayName: 'Features',
        name: 'features',
        type: 'multiOptions',
        displayOptions: {
          show: {
            operation: ['fetchOrganization'],
          },
        },
        options: [
          {
            name: 'Financial KPI',
            value: 'financial_kpi',
            description: '1 Credit - Annual financial key performance indicators',
          },
          {
            name: 'Balance Sheet Accounts',
            value: 'balance_sheet_accounts',
            description: '3 Credits - Hierarchical balance sheet data',
          },
          {
            name: 'Profit and Loss Account',
            value: 'profit_and_loss_account',
            description: '3 Credits - Detailed P&L statements',
          },
          {
            name: 'Related Persons',
            value: 'related_persons',
            description: '2 Credits - Current and former directors/executives',
          },
          {
            name: 'Shareholders',
            value: 'shareholders',
            description: '5 Credits - Company shareholders information',
          },
          {
            name: 'Publications',
            value: 'publications',
            description: '1 Credit - Official registry publications',
          },
          {
            name: 'News',
            value: 'news',
            description: '10 Credits - News articles about the company',
          },
          {
            name: 'Insolvency Publications',
            value: 'insolvency_publications',
            description: '1 Credit - Insolvency court publications',
          },
          {
            name: 'Annual Financial Statements',
            value: 'annual_financial_statements',
            description: '5 Credits - Full annual reports in Markdown format',
          },
          {
            name: 'Website Content',
            value: 'website_content',
            description: '0 Credits - Company website content (requires AI Mode to be enabled)',
          },
          {
            name: 'UBOs (Ultimate Beneficial Owners)',
            value: 'ubos',
            description: 'Ultimate beneficial owners with ownership percentages',
          },
          {
            name: 'Shareholdings',
            value: 'shareholdings',
            description: 'Outbound shareholdings the company holds in other companies',
          },
          {
            name: 'Annual Financial Statements (HTML)',
            value: 'annual_financial_statements__html',
            description: 'Full annual reports in HTML format (alternative to the Markdown variant)',
          },
        ],
        default: [],
        description: 'Additional data features to include',
      },
      {
        displayName: 'AI Mode',
        name: 'ai_search',
        type: 'boolean',
        default: true,
        description: 'Enable AI-powered search for better results',
        displayOptions: {
          show: {
            operation: ['fetchOrganization'],
          },
        },
      },
      {
        displayName: 'Realtime Mode',
        name: 'realtime_mode',
        type: 'boolean',
        default: false,
        description:
          'Enable live lookup against the official Handelsregister (+10 credits). Use when the cached data may be stale.',
        displayOptions: {
          show: {
            operation: ['fetchOrganization'],
          },
        },
      },
      // Fetch Person fields
      {
        displayName: 'Person Name',
        name: 'person_q',
        type: 'string',
        default: '',
        placeholder: 'e.g., Erika Mustermann',
        description: 'Full name of the person (minimum 2 characters)',
        displayOptions: {
          show: {
            operation: ['fetchPerson'],
          },
        },
        required: true,
      },
      {
        displayName: 'Organization',
        name: 'organization_q',
        type: 'string',
        default: '',
        placeholder: 'e.g., Musterfirma GmbH',
        description: 'Company context used to disambiguate common names (minimum 2 characters)',
        displayOptions: {
          show: {
            operation: ['fetchPerson'],
          },
        },
        required: true,
      },
      {
        displayName: 'Features',
        name: 'personFeatures',
        type: 'multiOptions',
        displayOptions: {
          show: {
            operation: ['fetchPerson'],
          },
        },
        options: [
          {
            name: 'Shareholdings',
            value: 'shareholdings',
            description:
              "Person's shareholdings across companies (+5 credits when data is returned)",
          },
        ],
        default: [],
        description: 'Optional additional data to include',
      },
      // Search Organizations fields
      {
        displayName: 'Query',
        name: 'q',
        type: 'string',
        default: '',
        placeholder: 'e.g., Konux',
        description: 'Search query (minimum 2 characters)',
        displayOptions: {
          show: {
            operation: ['searchOrganizations'],
          },
        },
        required: true,
      },
      {
        displayName: 'Additional Fields',
        name: 'additionalFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: {
          show: {
            operation: ['searchOrganizations'],
          },
        },
        options: [
          {
            displayName: 'Skip',
            name: 'skip',
            type: 'number',
            default: 0,
            description: 'Number of results to skip',
          },
          {
            displayName: 'Limit',
            name: 'limit',
            type: 'number',
            typeOptions: {
              minValue: 1,
              maxValue: 100,
            },
            default: 10,
            description: 'Results per page',
          },
          {
            displayName: 'Postal Code Filter',
            name: 'postal_code',
            type: 'string',
            default: '',
            description: 'Filter by postal code',
          },
        ],
      },
      // Fetch Document fields
      {
        displayName: 'Company ID',
        name: 'company_id',
        type: 'string',
        default: '',
        placeholder: 'e.g., 20a1510e88cd2e9b166db4d0bc5d563d',
        description: 'Unique company entity ID from search results',
        displayOptions: {
          show: {
            operation: ['fetchDocument'],
          },
        },
        required: true,
      },
      {
        displayName: 'Document Type',
        name: 'document_type',
        type: 'options',
        options: [
          {
            name: 'Shareholders List',
            value: 'shareholders_list',
            description: 'Gesellschafterliste document',
          },
          {
            name: 'Current Extract (AD)',
            value: 'AD',
            description: 'Current data extract',
          },
          {
            name: 'Historical Extract (CD)',
            value: 'CD',
            description: 'Chronological/historical data extract',
          },
          {
            name: 'Articles of Association',
            value: 'articles_of_association',
            description: 'Gesellschaftsvertrag / Satzung (founding articles / bylaws)',
          },
        ],
        default: 'shareholders_list',
        displayOptions: {
          show: {
            operation: ['fetchDocument'],
          },
        },
        required: true,
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('handelsregisterAiApi');

    const apiUrl = (credentials.apiUrl as string) || 'https://handelsregister.ai';

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter('operation', i) as string;
        let responseData;

        const options: IHttpRequestOptions = {
          method: 'GET',
          url: '',
          json: true,
          qs: {},
        };

        if (operation === 'fetchOrganization') {
          const query = this.getNodeParameter('q', i) as string;
          const features = this.getNodeParameter('features', i) as string[];
          const aiSearch = this.getNodeParameter('ai_search', i) as boolean;

          // Build query parameters manually to handle multiple feature params
          const queryParams = new URLSearchParams();
          queryParams.append('q', query);

          // Add each feature as a separate parameter
          if (features && features.length > 0) {
            features.forEach((feature) => {
              queryParams.append('feature', feature);
            });
          }

          if (aiSearch) {
            queryParams.append('ai_search', 'on-default');
          }

          const realtimeMode = this.getNodeParameter('realtime_mode', i, false) as boolean;
          if (realtimeMode) {
            queryParams.append('realtime_mode', 'handelsregister-default');
          }

          options.url = `${apiUrl}/api/v1/fetch-organization?${queryParams.toString()}`;
          // Remove qs since we're building the query string manually
          delete options.qs;
          responseData = await this.helpers.httpRequestWithAuthentication.call(
            this,
            'handelsregisterAiApi',
            options,
          );
        } else if (operation === 'searchOrganizations') {
          const query = this.getNodeParameter('q', i) as string;
          const additionalFields = this.getNodeParameter('additionalFields', i) as {
            skip?: number;
            limit?: number;
            postal_code?: string;
          };

          if (!options.qs) options.qs = {};
          options.qs.q = query;

          if (additionalFields.skip !== undefined) {
            options.qs.skip = additionalFields.skip;
          }
          if (additionalFields.limit !== undefined) {
            options.qs.limit = additionalFields.limit;
          }
          if (additionalFields.postal_code) {
            options.qs.filters = JSON.stringify({ postal_code: additionalFields.postal_code });
          }

          options.url = `${apiUrl}/api/v1/search-organizations`;
          responseData = await this.helpers.httpRequestWithAuthentication.call(
            this,
            'handelsregisterAiApi',
            options,
          );
        } else if (operation === 'fetchDocument') {
          const companyId = this.getNodeParameter('company_id', i) as string;
          const documentType = this.getNodeParameter('document_type', i) as string;

          if (!options.qs) options.qs = {};
          options.qs.company_id = companyId;
          options.qs.document_type = documentType;

          options.url = `${apiUrl}/api/v1/fetch-document`;

          // Configure for binary response
          options.encoding = 'arraybuffer';
          options.json = false;

          const response = await this.helpers.httpRequestWithAuthentication.call(
            this,
            'handelsregisterAiApi',
            options,
          );

          // Convert arraybuffer to Buffer for prepareBinaryData
          const buffer = Buffer.from(response);

          const binaryData = await this.helpers.prepareBinaryData(
            buffer,
            `${companyId}_${documentType}.pdf`,
            'application/pdf',
          );

          returnData.push({
            json: { company_id: companyId, document_type: documentType },
            binary: { data: binaryData },
            pairedItem: { item: i },
          });
          continue;
        } else if (operation === 'fetchPerson') {
          const personQ = this.getNodeParameter('person_q', i) as string;
          const organizationQ = this.getNodeParameter('organization_q', i) as string;
          const personFeatures = this.getNodeParameter('personFeatures', i, []) as string[];

          const queryParams = new URLSearchParams();
          queryParams.append('person_q', personQ);
          queryParams.append('organization_q', organizationQ);

          if (personFeatures && personFeatures.length > 0) {
            personFeatures.forEach((feature) => {
              queryParams.append('feature', feature);
            });
          }

          options.url = `${apiUrl}/api/v1/fetch-person?${queryParams.toString()}`;
          delete options.qs;
          responseData = await this.helpers.httpRequestWithAuthentication.call(
            this,
            'handelsregisterAiApi',
            options,
          );
        }

        // Handle different response formats
        if (operation === 'searchOrganizations' && responseData?.results) {
          // Search returns results array with metadata
          returnData.push(
            ...responseData.results.map((item: SearchResultItem) => ({
              json: {
                ...item,
                _meta: {
                  total: responseData.total,
                  request_credit_cost: responseData.meta?.request_credit_cost,
                  credits_remaining: responseData.meta?.credits_remaining,
                },
              },
              pairedItem: { item: i },
            })),
          );
        } else if (Array.isArray(responseData)) {
          returnData.push(...responseData.map((item) => ({ json: item, pairedItem: { item: i } })));
        } else {
          returnData.push({ json: responseData, pairedItem: { item: i } });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          returnData.push({ json: { error: errorMessage }, pairedItem: { item: i } });
          continue;
        }
        throw new NodeOperationError(
          this.getNode(),
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    return [returnData];
  }
}
