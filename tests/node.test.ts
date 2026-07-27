import type { IExecuteFunctions, IHttpRequestOptions, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { HandelsregisterAi } from '../nodes/HandelsregisterAi/HandelsregisterAi.node';

type Parameters = Record<string, unknown>;

function createContext(
  parameters: Parameters[],
  responses: unknown[] = [],
  options: {
    continueOnFail?: boolean;
    credentials?: Record<string, unknown>;
  } = {},
): {
  context: IExecuteFunctions;
  request: ReturnType<typeof vi.fn>;
  prepareBinaryData: ReturnType<typeof vi.fn>;
} {
  const responseQueue = [...responses];
  const request = vi.fn(async (_credential: string, requestOptions: IHttpRequestOptions) => {
    const next = responseQueue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(requestOptions);
    return next;
  });
  const prepareBinaryData = vi.fn(async (_buffer: Buffer, fileName: string, mimeType: string) => ({
    data: 'base64',
    fileName,
    mimeType,
  }));

  const context = {
    getInputData: () => parameters.map((json) => ({ json })) as INodeExecutionData[],
    getCredentials: vi.fn(async () => ({
      apiUrl: 'https://api.example.test/',
      ...options.credentials,
    })),
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) =>
      Object.prototype.hasOwnProperty.call(parameters[itemIndex], name)
        ? parameters[itemIndex][name]
        : fallback,
    getNode: () => ({
      id: 'node-id',
      name: 'handelsregister.ai',
      type: '@handelsregister/n8n-nodes-handelsregister-ai.handelsregisterAi',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    }),
    continueOnFail: () => options.continueOnFail ?? false,
    helpers: {
      httpRequestWithAuthentication: request,
      prepareBinaryData,
    },
  } as unknown as IExecuteFunctions;

  return { context, request, prepareBinaryData };
}

async function execute(context: IExecuteFunctions): Promise<INodeExecutionData[]> {
  const node = new HandelsregisterAi();
  const [results] = await node.execute.call(context);
  return results;
}

describe('HandelsregisterAi node', () => {
  it('exposes supported data operations without administrative token operations', () => {
    const properties = new HandelsregisterAi().description.properties;
    const operation = properties.find((property) => property.name === 'operation');
    const features = properties.find((property) => property.name === 'features');
    const documentType = properties.find((property) => property.name === 'document_type');
    const additionalFields = properties.find((property) => property.name === 'additionalFields');
    const limit = additionalFields?.options?.find((option) => option.name === 'limit');

    expect(features?.options?.some((option) => option.value === 'mergers_and_acquisitions')).toBe(
      true,
    );
    expect(documentType?.options?.some((option) => option.value === 'SI')).toBe(true);
    expect(limit?.typeOptions?.maxValue).toBe(30);
    expect(operation?.options?.map((option) => option.value)).toEqual([
      'fetchDocument',
      'fetchOrganization',
      'fetchPerson',
      'searchOrganizations',
    ]);
  });

  it('fetches organization data with repeated features and preserves item linking', async () => {
    const { context, request } = createContext(
      [
        {
          operation: 'fetchOrganization',
          q: 'BMW AG',
          features: ['related_persons', 'mergers_and_acquisitions'],
          ai_search: true,
          realtime_mode: false,
        },
      ],
      [{ entity_id: 'bmw', representation_scheme: { current: ['rule'] } }],
    );

    const results = await execute(context);
    const url = new URL(request.mock.calls[0][1].url);
    expect(url.searchParams.getAll('feature')).toEqual([
      'related_persons',
      'mergers_and_acquisitions',
    ]);
    expect(url.searchParams.get('ai_search')).toBe('on-default');
    expect(results[0].pairedItem).toEqual({ item: 0 });
    expect(results[0].json.representation_scheme).toEqual({ current: ['rule'] });
  });

  it('transparently recovers when an API request initially returns HTTP 408', async () => {
    vi.useFakeTimers();
    try {
      const timeout = Object.assign(new Error('Request timeout'), {
        response: { status: 408 },
      });
      const { context, request } = createContext(
        [
          {
            operation: 'fetchOrganization',
            q: 'BMW AG',
            features: [],
            ai_search: false,
            realtime_mode: false,
          },
        ],
        [timeout, { entity_id: 'bmw' }],
      );

      const execution = execute(context);
      await vi.runAllTimersAsync();

      await expect(execution).resolves.toMatchObject([{ json: { entity_id: 'bmw' } }]);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports filter-only search and returns one item per result', async () => {
    const { context, request } = createContext(
      [
        {
          operation: 'searchOrganizations',
          q: '',
          searchAiMode: true,
          returnAll: false,
          searchOutput: 'split',
          additionalFields: {
            limit: 30,
            postal_code: '80331',
            legal_form_code: 'GmbH,UG',
          },
        },
      ],
      [
        {
          results: [{ entity_id: 'one', name: 'One GmbH' }],
          total: 1,
          meta: { request_credit_cost: 5, credits_remaining: 95 },
        },
      ],
    );

    const results = await execute(context);
    const options = request.mock.calls[0][1] as IHttpRequestOptions;
    expect(options.qs?.q).toBeUndefined();
    expect(options.qs?.limit).toBe(30);
    expect(options.qs?.ai_mode).toBe('on-default');
    expect(JSON.parse(String(options.qs?.filters))).toEqual({
      postal_code: '80331',
      legal_form_code: ['GmbH', 'UG'],
    });
    expect(results[0].json._meta).toEqual({
      total: 1,
      request_credit_cost: 5,
      credits_remaining: 95,
    });
  });

  it('fetches all search pages in batches of 30 and aggregates credit cost', async () => {
    const firstPage = Array.from({ length: 30 }, (_, index) => ({
      entity_id: `first-${index}`,
      name: `First ${index}`,
    }));
    const secondPage = [
      { entity_id: 'second-1', name: 'Second 1' },
      { entity_id: 'second-2', name: 'Second 2' },
    ];
    const { context, request } = createContext(
      [
        {
          operation: 'searchOrganizations',
          q: 'tech',
          returnAll: true,
          maxResults: 0,
          searchOutput: 'response',
          additionalFields: { skip: 0 },
        },
      ],
      [
        {
          results: firstPage,
          total: 32,
          meta: { request_credit_cost: 1, credits_remaining: 99 },
        },
        {
          results: secondPage,
          total: 32,
          meta: { request_credit_cost: 1, credits_remaining: 98 },
        },
      ],
    );

    const results = await execute(context);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].qs).toMatchObject({ skip: 0, limit: 30 });
    expect(request.mock.calls[1][1].qs).toMatchObject({ skip: 30, limit: 30 });
    expect(results[0].json.results).toHaveLength(32);
    expect(results[0].json.meta).toMatchObject({
      request_credit_cost: 2,
      credits_remaining: 98,
    });
  });

  it('honors Maximum Results while paginating', async () => {
    const page = Array.from({ length: 30 }, (_, index) => ({
      entity_id: `entity-${index}`,
      name: `Entity ${index}`,
    }));
    const { context, request } = createContext(
      [
        {
          operation: 'searchOrganizations',
          q: 'tech',
          returnAll: true,
          maxResults: 5,
          searchOutput: 'response',
          additionalFields: {},
        },
      ],
      [{ results: page, total: 100, meta: { request_credit_cost: 1 } }],
    );

    const results = await execute(context);
    expect(request).toHaveBeenCalledTimes(1);
    expect(results[0].json.results).toHaveLength(5);
  });

  it('returns SI as XML binary data with the server filename', async () => {
    const { context, request, prepareBinaryData } = createContext(
      [
        {
          operation: 'fetchDocument',
          company_id: 'entity',
          document_type: 'SI',
        },
      ],
      [
        {
          body: Buffer.from('<register/>'),
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'content-disposition': 'attachment; filename="register.xml"',
          },
        },
      ],
    );

    const results = await execute(context);
    expect(request.mock.calls[0][1]).toMatchObject({
      encoding: 'arraybuffer',
      returnFullResponse: true,
      json: false,
    });
    expect(prepareBinaryData).toHaveBeenCalledWith(
      Buffer.from('<register/>'),
      'register.xml',
      'application/xml',
    );
    expect(results[0].json).toMatchObject({
      file_name: 'register.xml',
      mime_type: 'application/xml',
    });
  });

  it('returns structured API errors when Continue On Fail is enabled', async () => {
    const apiFailure = Object.assign(new Error('Request failed'), {
      response: {
        status: 403,
        data: {
          error: 'subscription_required',
          meta: { message: 'An active subscription is required' },
        },
      },
    });
    const { context } = createContext(
      [
        {
          operation: 'fetchPerson',
          person_q: 'Erika Mustermann',
          organization_q: 'Musterfirma GmbH',
          personFeatures: [],
        },
      ],
      [apiFailure],
      { continueOnFail: true },
    );

    const results = await execute(context);
    expect(results[0].json).toEqual({
      error: 'subscription_required',
      status_code: 403,
      code: 'subscription_required',
      meta: { message: 'An active subscription is required' },
    });
    expect(results[0].pairedItem).toEqual({ item: 0 });
  });

  it('links independently processed input items to their source item', async () => {
    const { context } = createContext(
      [
        {
          operation: 'fetchPerson',
          person_q: 'Alice Example',
          organization_q: 'One GmbH',
          personFeatures: [],
        },
        {
          operation: 'fetchPerson',
          person_q: 'Bob Example',
          organization_q: 'Two GmbH',
          personFeatures: [],
        },
      ],
      [{ entity_id: 'alice' }, { entity_id: 'bob' }],
    );

    const results = await execute(context);
    expect(results.map((result) => result.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });
});
