import {
  type IExecuteFunctions,
  type IHttpRequestOptions,
  type INodeExecutionData,
  NodeConnectionTypes,
} from 'n8n-workflow';
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
    const description = new HandelsregisterAi().description;
    const properties = description.properties;
    const operation = properties.find((property) => property.name === 'operation');
    const features = properties.find((property) => property.name === 'features');
    const documentType = properties.find((property) => property.name === 'document_type');
    const additionalFields = properties.find((property) => property.name === 'additionalFields');
    const signalTopics = properties.find((property) => property.name === 'signalTopics');
    const pageSize = additionalFields?.options?.find((option) => option.name === 'pageSize');

    expect(description.icon).toEqual({
      light: 'file:../../icons/handelsregister_ai.svg',
      dark: 'file:../../icons/handelsregister_ai.dark.svg',
    });
    expect(description.inputs).toEqual([NodeConnectionTypes.Main]);
    expect(description.outputs).toEqual([NodeConnectionTypes.Main]);
    expect(description.subtitle).toBe('={{$parameter["operation"]}}');
    expect(description.usableAsTool).toBe(true);
    expect(features?.options?.some((option) => option.value === 'mergers_and_acquisitions')).toBe(
      true,
    );
    expect(documentType?.options?.some((option) => option.value === 'SI')).toBe(true);
    expect(signalTopics?.options).toHaveLength(7);
    expect(signalTopics?.options?.some((option) => option.value === 'INSOLVENCIES')).toBe(true);
    expect(signalTopics?.options?.some((option) => option.value === 'TRANSFORMATIONS')).toBe(true);
    expect(pageSize?.typeOptions?.maxValue).toBe(30);
    expect(operation?.options?.map((option) => option.value)).toEqual([
      'fetchDocument',
      'fetchOrganization',
      'fetchPerson',
      'getSignal',
      'getSignalCatalog',
      'listSignals',
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
            pageSize: 30,
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

  it('gets the Signal catalog and a URL-encoded Signal detail with item linking', async () => {
    const { context, request } = createContext(
      [{ operation: 'getSignalCatalog' }, { operation: 'getSignal', signalId: 'signal/id?value' }],
      [
        {
          topics: [{ code: 'CAPITAL_CHANGES' }],
          meta: { request_credit_cost: 0 },
        },
        {
          signal: { event: { id: 'signal/id?value', topic: 'CAPITAL_CHANGES' } },
          meta: { request_credit_cost: 20 },
        },
      ],
    );

    const results = await execute(context);
    expect(request.mock.calls[0][1].url).toBe('https://api.example.test/api/v1/signals/catalog');
    expect(request.mock.calls[1][1].url).toBe(
      'https://api.example.test/api/v1/signals/signal%2Fid%3Fvalue',
    );
    expect(results.map((result) => result.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
    expect(results[0].json.topics).toHaveLength(1);
    expect(results[1].json.signal).toMatchObject({
      event: { topic: 'CAPITAL_CHANGES' },
    });
  });

  it('lists filtered Signals as one n8n item per Signal', async () => {
    const { context, request } = createContext(
      [
        {
          operation: 'listSignals',
          signalTopics: ['CAPITAL_CHANGES', 'TRANSFORMATIONS'],
          signalOrganizationIds: 'org-one, org-two',
          signalFrom: '2026-07-01',
          signalTo: '2026-07-30',
          signalsReturnAll: false,
          signalCursor: '',
          signalsOutput: 'split',
        },
      ],
      [
        {
          signals: [
            { event: { id: 'event-one', topic: 'CAPITAL_CHANGES' } },
            { event: { id: 'event-two', topic: 'TRANSFORMATIONS' } },
          ],
          pagination: {
            mode: 'CURSOR',
            limit: 20,
            returned: 2,
            has_more: false,
          },
          filters: { topics: ['CAPITAL_CHANGES', 'TRANSFORMATIONS'] },
          warnings: [],
          meta: { request_credit_cost: 20, credits_remaining: 80 },
        },
      ],
    );

    const results = await execute(context);
    expect(request.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      url: 'https://api.example.test/api/v1/signals',
      qs: {
        topics: 'CAPITAL_CHANGES,TRANSFORMATIONS',
        organization_ids: 'org-one,org-two',
        from: '2026-07-01',
        to: '2026-07-30',
      },
      json: true,
    });
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.json.event)).toEqual([
      { id: 'event-one', topic: 'CAPITAL_CHANGES' },
      { id: 'event-two', topic: 'TRANSFORMATIONS' },
    ]);
    expect(results[0].json._meta).toEqual({
      request_credit_cost: 20,
      credits_remaining: 80,
      pages_fetched: 1,
    });
    expect(results.every((result) => result.pairedItem?.item === 0)).toBe(true);
  });

  it('follows opaque Signals cursors, aggregates credit cost, and honors Maximum Results', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      event: { id: `first-${index}`, topic: 'NEW_REGISTRATIONS' },
    }));
    const secondPage = Array.from({ length: 20 }, (_, index) => ({
      event: { id: `second-${index}`, topic: 'NEW_REGISTRATIONS' },
    }));
    const { context, request } = createContext(
      [
        {
          operation: 'listSignals',
          signalTopics: ['NEW_REGISTRATIONS'],
          signalOrganizationIds: '',
          signalFrom: '',
          signalTo: '',
          signalsReturnAll: true,
          signalsMaxResults: 21,
          signalsOutput: 'response',
        },
      ],
      [
        {
          signals: firstPage,
          pagination: { mode: 'CURSOR', limit: 20, has_more: true, next_cursor: 'opaque' },
          filters: { topics: ['NEW_REGISTRATIONS'] },
          warnings: [],
          meta: { request_credit_cost: 20, credits_remaining: 80 },
        },
        {
          signals: secondPage,
          pagination: { mode: 'CURSOR', limit: 20, has_more: true, next_cursor: 'next' },
          filters: { topics: ['NEW_REGISTRATIONS'] },
          warnings: [],
          meta: { request_credit_cost: 20, credits_remaining: 60 },
        },
      ],
    );

    const results = await execute(context);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].qs).toEqual({ topics: 'NEW_REGISTRATIONS' });
    expect(request.mock.calls[1][1].qs).toEqual({
      topics: 'NEW_REGISTRATIONS',
      cursor: 'opaque',
    });
    expect(results[0].json.signals).toHaveLength(21);
    expect(results[0].json.pagination).toEqual({
      mode: 'CURSOR',
      limit: 20,
      returned: 21,
      has_more: false,
      next_cursor: null,
      pages_fetched: 2,
      truncated: true,
    });
    expect(results[0].json.meta).toMatchObject({
      request_credit_cost: 40,
      credits_remaining: 60,
    });
  });

  it('preserves a manual Signals cursor and rejects repeated pagination cursors', async () => {
    const manual = createContext(
      [
        {
          operation: 'listSignals',
          signalTopics: [],
          signalOrganizationIds: '',
          signalFrom: '',
          signalTo: '',
          signalsReturnAll: false,
          signalCursor: 'manual-cursor',
          signalsOutput: 'response',
        },
      ],
      [
        {
          signals: [],
          pagination: { mode: 'CURSOR', limit: 20, has_more: false },
          filters: {},
          warnings: [],
          meta: { request_credit_cost: 20 },
        },
      ],
    );
    const manualResults = await execute(manual.context);
    expect(manual.request.mock.calls[0][1].qs).toEqual({ cursor: 'manual-cursor' });
    expect(manualResults[0].json.pagination).toMatchObject({ has_more: false });

    const repeated = createContext(
      [
        {
          operation: 'listSignals',
          signalTopics: [],
          signalOrganizationIds: '',
          signalFrom: '',
          signalTo: '',
          signalsReturnAll: true,
          signalsMaxResults: 0,
          signalsOutput: 'response',
        },
      ],
      [
        {
          signals: [{ event: { id: 'one' } }],
          pagination: { has_more: true, next_cursor: 'repeated' },
          meta: { request_credit_cost: 20 },
        },
        {
          signals: [{ event: { id: 'two' } }],
          pagination: { has_more: true, next_cursor: 'repeated' },
          meta: { request_credit_cost: 20 },
        },
      ],
    );
    await expect(execute(repeated.context)).rejects.toThrow(/repeated.*cursor/i);
  });

  it('returns a structured plan error for restricted Signal topics', async () => {
    const failure = Object.assign(new Error('Request failed'), {
      response: {
        status: 403,
        data: {
          error: 'plan_required',
          meta: { message: 'This Signal topic requires another plan' },
        },
      },
    });
    const { context } = createContext(
      [
        {
          operation: 'listSignals',
          signalTopics: ['TRANSFORMATIONS'],
          signalsReturnAll: false,
          signalsOutput: 'response',
        },
      ],
      [failure],
      { continueOnFail: true },
    );

    const results = await execute(context);
    expect(results[0].json).toEqual({
      error: 'plan_required',
      status_code: 403,
      code: 'plan_required',
      meta: { message: 'This Signal topic requires another plan' },
    });
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
