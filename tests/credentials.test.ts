import type { IAuthenticate, IHttpRequestOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { HandelsregisterAiApi } from '../credentials/HandelsregisterAiApi.credentials';

async function authenticate(
  credentials: Record<string, unknown>,
  request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  const credentialType = new HandelsregisterAiApi();
  const handler = credentialType.authenticate as Exclude<IAuthenticate, object>;
  return handler(credentials, request);
}

describe('HandelsregisterAi credentials', () => {
  it('preserves existing API-key credentials when the method field is absent', async () => {
    const request = await authenticate(
      { apiKey: 'api-test' },
      { method: 'GET', url: 'https://example.test' },
    );
    expect(request.headers).toEqual({ 'x-api-key': 'api-test' });
  });

  it('uses a Bearer Authorization header without also sending the API key', async () => {
    const request = await authenticate(
      {
        authenticationMethod: 'bearerToken',
        bearerToken: 'bearer-test',
        apiKey: 'must-not-be-used',
      },
      { method: 'GET', url: 'https://example.test', headers: { Accept: 'application/json' } },
    );
    expect(request.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer bearer-test',
    });
  });
});
