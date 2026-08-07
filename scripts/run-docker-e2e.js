const { spawnSync } = require('child_process');
const nodeCrypto = require('crypto');

const CONTAINER = 'handelsregister-n8n-e2e-n8n-1';
const CREDENTIAL_ID = 'hrai-e2e-api-key';
const CREDENTIAL_NAME = 'handelsregister.ai E2E';
const NODE_TYPE = '@handelsregister/n8n-nodes-handelsregister-ai.handelsregisterAi';
const API_KEY_ENV = 'HANDELSREGISTER_API_KEY_THROW_AWAY';

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    const stdout = String(result.stdout ?? '').trim();
    throw new Error(
      `docker ${args.join(' ')} failed (${result.status})${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`,
    );
  }
  return result.stdout;
}

function putJson(containerPath, value) {
  runDocker(['exec', '-i', CONTAINER, 'sh', '-lc', `umask 077; sed -n 'w ${containerPath}'`], {
    input: JSON.stringify(value),
  });
}

function removeContainerFile(containerPath) {
  runDocker(['exec', CONTAINER, 'rm', '-f', containerPath]);
}

function importCredential(id, name, data) {
  const path = `/tmp/${id}.json`;
  putJson(path, [{ id, name, type: 'handelsregisterAiApi', data }]);
  try {
    runDocker([
      'exec',
      CONTAINER,
      'n8n',
      'import:credentials',
      `--input=${path}`,
      '--include=id,name,type,data',
    ]);
  } finally {
    removeContainerFile(path);
  }
}

function parseRawExecutionOutput(output) {
  const trimmed = String(output).trim();
  for (let start = 0; start < trimmed.length; start++) {
    const opening = trimmed[start];
    if (opening !== '{' && opening !== '[') continue;
    const stack = [opening];
    let inString = false;
    let escaped = false;
    for (let end = start + 1; end < trimmed.length; end++) {
      const character = trimmed[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{' || character === '[') {
        stack.push(character);
        continue;
      }
      if (character !== '}' && character !== ']') continue;
      const expectedOpening = character === '}' ? '{' : '[';
      if (stack.at(-1) !== expectedOpening) break;
      stack.pop();
      if (stack.length !== 0) continue;
      const candidate = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        break;
      }
    }
  }
  throw new Error(`n8n did not return parseable JSON: ${trimmed.slice(-1000)}`);
}

function workflow(
  id,
  name,
  parameters,
  credentialId = CREDENTIAL_ID,
  credentialName = CREDENTIAL_NAME,
  continueOnFail = false,
) {
  const startName = 'When clicking Execute Workflow';
  const nodeName = 'handelsregister.ai';
  return {
    id,
    name,
    nodes: [
      {
        parameters: {},
        id: nodeCrypto.randomUUID(),
        name: startName,
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
      },
      {
        parameters,
        id: nodeCrypto.randomUUID(),
        name: nodeName,
        type: NODE_TYPE,
        typeVersion: 1,
        position: [260, 0],
        credentials: {
          handelsregisterAiApi: {
            id: credentialId,
            name: credentialName,
          },
        },
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 1000,
        ...(continueOnFail ? { continueOnFail: true } : {}),
      },
    ],
    connections: {
      [startName]: {
        main: [[{ node: nodeName, type: 'main', index: 0 }]],
      },
    },
    active: false,
    settings: {
      executionOrder: 'v1',
    },
  };
}

function executeWorkflow(name, parameters, options = {}) {
  const workflowId = nodeCrypto.randomUUID();
  const path = `/tmp/hrai-${nodeCrypto.randomUUID()}.json`;
  putJson(
    path,
    workflow(
      workflowId,
      name,
      parameters,
      options.credentialId,
      options.credentialName,
      options.continueOnFail,
    ),
  );
  try {
    runDocker(['exec', CONTAINER, 'n8n', 'import:workflow', `--input=${path}`]);
    const output = runDocker([
      'exec',
      '-e',
      'N8N_RUNNERS_BROKER_PORT=5680',
      CONTAINER,
      'n8n',
      'execute',
      `--id=${workflowId}`,
      '--rawOutput',
    ]);
    return parseRawExecutionOutput(output);
  } finally {
    removeContainerFile(path);
  }
}

function outputItems(execution) {
  if (Array.isArray(execution)) return execution;
  const runData = execution?.data?.resultData?.runData ?? execution?.resultData?.runData;
  const runs = runData?.['handelsregister.ai'];
  const items = runs?.at(-1)?.data?.main?.[0];
  if (!Array.isArray(items)) {
    throw new Error('Could not find handelsregister.ai output items in the n8n execution result');
  }
  return items;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function firstJson(execution) {
  const value = outputItems(execution)[0]?.json;
  assert(value && typeof value === 'object', 'Workflow returned no JSON data');
  return value;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function main() {
  const apiKey = process.env[API_KEY_ENV];
  if (!apiKey) {
    throw new Error(`${API_KEY_ENV} must be set`);
  }

  importCredential(CREDENTIAL_ID, CREDENTIAL_NAME, {
    authenticationMethod: 'apiKey',
    apiKey,
    apiUrl: 'https://handelsregister.ai',
  });

  const searchExecution = executeWorkflow('E2E search', {
    operation: 'searchOrganizations',
    q: 'BMW AG',
    searchAiMode: false,
    returnAll: false,
    searchOutput: 'response',
    additionalFields: { pageSize: 2 },
  });
  const searchItems = outputItems(searchExecution);
  const search = searchItems[0]?.json;
  assert(Array.isArray(search?.results), 'Search response is missing results');
  assert(search.results.length > 0 && search.results.length <= 2, 'Search limit was not respected');
  assert(typeof search.total === 'number', 'Search response is missing total');
  assert(search.results[0]?.entity_id, 'Search result is missing entity_id');
  const organizationId = search.results[0].entity_id;

  const signalCatalog = firstJson(
    executeWorkflow('E2E Signal catalog', {
      operation: 'getSignalCatalog',
    }),
  );
  assert(Array.isArray(signalCatalog.topics), 'Signal catalog is missing topics');
  assert(signalCatalog.topics.length === 7, 'Signal catalog did not return all seven topics');
  assert(
    signalCatalog.topics.some((topic) => topic?.code === 'INSOLVENCIES'),
    'Signal catalog is missing INSOLVENCIES',
  );
  assert(
    signalCatalog.topics.some((topic) => topic?.code === 'TRANSFORMATIONS'),
    'Signal catalog is missing TRANSFORMATIONS',
  );
  assert(Number(signalCatalog.meta?.request_credit_cost) === 0, 'Signal catalog was not free');

  const signalPage = firstJson(
    executeWorkflow('E2E Signals first page', {
      operation: 'listSignals',
      signalTopics: [],
      signalOrganizationIds: '',
      signalFrom: '',
      signalTo: '',
      signalsReturnAll: false,
      signalCursor: '',
      signalsOutput: 'response',
    }),
  );
  assert(Array.isArray(signalPage.signals), 'Signals response is missing signals');
  assert(signalPage.signals.length === 20, 'Signals first page did not return 20 entries');
  assert(signalPage.pagination?.has_more === true, 'Signals first page has no next page');
  assert(signalPage.pagination?.next_cursor, 'Signals first page is missing next_cursor');
  assert(
    Number(signalPage.meta?.request_credit_cost) === 20,
    'Signals first page did not report the expected credit cost',
  );

  const firstSignalId = signalPage.signals[0]?.event?.id;
  assert(firstSignalId, 'Signals first page contains no event ID');
  const signalDetailResponse = firstJson(
    executeWorkflow('E2E Signal detail', {
      operation: 'getSignal',
      signalId: firstSignalId,
    }),
  );
  const signalDetail = signalDetailResponse.signal ?? signalDetailResponse;
  assert(signalDetail.event?.id === firstSignalId, 'Signal detail returned the wrong event');

  const paginatedSignals = firstJson(
    executeWorkflow('E2E Signals cursor pagination', {
      operation: 'listSignals',
      signalTopics: [],
      signalOrganizationIds: '',
      signalFrom: '',
      signalTo: '',
      signalsReturnAll: true,
      signalsMaxResults: 21,
      signalsOutput: 'response',
    }),
  );
  assert(
    paginatedSignals.signals?.length === 21,
    'Signals Return All did not follow the cursor to a second page',
  );
  assert(
    paginatedSignals.pagination?.pages_fetched === 2,
    'Signals cursor pagination did not report two fetched pages',
  );
  assert(
    Number(paginatedSignals.meta?.request_credit_cost) === 40,
    'Signals cursor pagination did not aggregate page credit costs',
  );

  const entitledSignals = firstJson(
    executeWorkflow('E2E entitled Signal topics', {
      operation: 'listSignals',
      signalTopics: ['INSOLVENCIES', 'TRANSFORMATIONS'],
      signalOrganizationIds: '',
      signalFrom: '',
      signalTo: '',
      signalsReturnAll: false,
      signalCursor: '',
      signalsOutput: 'response',
    }),
  );
  assert(
    entitledSignals.signals?.every((signal) =>
      ['INSOLVENCIES', 'TRANSFORMATIONS'].includes(signal?.event?.topic),
    ),
    'Signals topic filtering returned a topic outside the requested Pro/Max set',
  );

  const signalOrganizationIds = [
    ...new Set(
      paginatedSignals.signals.map((signal) => signal?.organization?.entity_id).filter(Boolean),
    ),
  ].slice(0, 2);
  assert(
    signalOrganizationIds.length === 2,
    'Could not obtain two organization IDs for the Signals filter test',
  );
  const organizationSignals = firstJson(
    executeWorkflow('E2E multiple Signal organization IDs', {
      operation: 'listSignals',
      signalTopics: [],
      signalOrganizationIds: signalOrganizationIds.join(','),
      signalFrom: '',
      signalTo: '',
      signalsReturnAll: false,
      signalCursor: '',
      signalsOutput: 'response',
    }),
  );
  assert(
    organizationSignals.signals?.every((signal) =>
      signalOrganizationIds.includes(signal?.organization?.entity_id),
    ),
    'Signals organization filtering returned an organization outside the requested set',
  );

  const filterSearch = firstJson(
    executeWorkflow('E2E filter-only search', {
      operation: 'searchOrganizations',
      q: '',
      searchAiMode: false,
      returnAll: false,
      searchOutput: 'response',
      additionalFields: { city: 'München', active: true, pageSize: 1 },
    }),
  );
  assert(filterSearch.results?.length === 1, 'Filter-only search did not return one result');
  assert(filterSearch.results[0]?.address?.city === 'München', 'City filter was not respected');

  const paginatedSearch = firstJson(
    executeWorkflow('E2E paginated search', {
      operation: 'searchOrganizations',
      q: 'GmbH',
      searchAiMode: false,
      returnAll: true,
      maxResults: 31,
      searchOutput: 'response',
      additionalFields: {},
    }),
  );
  assert(
    paginatedSearch.results?.length === 31,
    'Return All did not paginate beyond the 30-item API maximum',
  );
  assert(
    Number(paginatedSearch.meta?.request_credit_cost) >= 2,
    'Paginated search did not aggregate page credit costs',
  );

  const organization = firstJson(
    executeWorkflow('E2E organization and representation schemes', {
      operation: 'fetchOrganization',
      q: organizationId,
      features: ['related_persons'],
      ai_search: false,
      realtime_mode: false,
    }),
  );
  assert(
    organization.entity_id === organizationId,
    'Organization lookup returned the wrong entity',
  );
  assert(
    hasOwn(organization, 'representation_scheme'),
    'Organization representation scheme missing',
  );
  assert(
    Array.isArray(organization.related_persons?.current),
    'Related persons response is missing current persons',
  );
  assert(
    organization.related_persons.current.some(
      (person) =>
        person &&
        typeof person === 'object' &&
        hasOwn(person, 'organization_representation_scheme') &&
        hasOwn(person, 'role_representation_scheme'),
    ),
    'Person-level representation schemes are missing',
  );

  const mergerSearch = firstJson(
    executeWorkflow('E2E M&A company search', {
      operation: 'searchOrganizations',
      q: 'Teltec AG',
      searchAiMode: false,
      returnAll: false,
      searchOutput: 'response',
      additionalFields: { pageSize: 5 },
    }),
  );
  const mergerOrganization = mergerSearch.results?.find((result) => result.name === 'Teltec AG');
  assert(mergerOrganization?.entity_id, 'Could not resolve the M&A test organization');
  const mergersAndAcquisitions = firstJson(
    executeWorkflow('E2E mergers and acquisitions', {
      operation: 'fetchOrganization',
      q: mergerOrganization.entity_id,
      features: ['mergers_and_acquisitions'],
      ai_search: false,
      realtime_mode: false,
    }),
  );
  assert(
    Array.isArray(mergersAndAcquisitions.mergers_and_acquisitions?.transactions),
    'Mergers and acquisitions transactions are missing',
  );
  assert(
    mergersAndAcquisitions.mergers_and_acquisitions.transactions.length > 0,
    'Mergers and acquisitions returned no transactions for the test organization',
  );

  const currentPerson = organization.related_persons.current.find(
    (person) => person?.name && person?.entity_id,
  );
  assert(currentPerson, 'Could not resolve a person for the fetch-person live test');
  const person = firstJson(
    executeWorkflow(
      'E2E person',
      {
        operation: 'fetchPerson',
        person_q: currentPerson.name,
        organization_q: organization.name,
        personFeatures: [],
      },
      { continueOnFail: true },
    ),
  );
  const subscriptionBlocked =
    Number(person.status_code) === 403 ||
    person.code === 'subscription_required' ||
    String(person.error ?? '')
      .toLowerCase()
      .includes('subscription');
  const personSupported = !subscriptionBlocked;
  if (personSupported) {
    assert(
      !person.error,
      `Person endpoint returned an error (status ${person.status_code ?? 'unknown'}, code ${person.code ?? 'unknown'})`,
    );
    assert(
      Object.keys(person).some((key) => key !== 'meta'),
      'Person endpoint returned no person data',
    );
  } else {
    assert(subscriptionBlocked, 'Person endpoint failed for an unexpected reason');
  }

  const documentItems = outputItems(
    executeWorkflow('E2E SI document', {
      operation: 'fetchDocument',
      company_id: organizationId,
      document_type: 'SI',
    }),
  );
  const documentItem = documentItems[0];
  assert(documentItem?.json?.document_type === 'SI', 'SI document metadata is missing');
  assert(
    ['application/xml', 'text/xml'].includes(documentItem.json.mime_type),
    'SI document did not use an XML MIME type',
  );
  assert(documentItem.binary?.data?.data, 'SI document binary data is missing');

  console.log(
    JSON.stringify({
      status: 'ok',
      search: {
        resultCount: search.results.length,
        total: search.total,
      },
      filterOnlySearch: {
        resultCount: filterSearch.results.length,
      },
      pagination: {
        resultCount: paginatedSearch.results.length,
      },
      signals: {
        catalogTopics: signalCatalog.topics.length,
        firstPageCount: signalPage.signals.length,
        cursorResultCount: paginatedSignals.signals.length,
        proAndMaxTopics: true,
        multipleOrganizationIds: true,
        detail: true,
      },
      organization: {
        representationScheme: true,
        personRepresentationSchemes: true,
      },
      mergersAndAcquisitions: {
        transactionCount: mergersAndAcquisitions.mergers_and_acquisitions.transactions.length,
      },
      person: {
        supportedByAccount: personSupported,
      },
      document: {
        type: documentItem.json.document_type,
        mimeType: documentItem.json.mime_type,
      },
    }),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
