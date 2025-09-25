import {
  ICredentialType,
  INodeProperties,
  ICredentialTestRequest,
  IAuthenticateGeneric,
} from 'n8n-workflow';

export class HandelsregisterAiApi implements ICredentialType {
  name = 'handelsregisterAiApi';
  displayName = 'Handelsregister.ai API';
  documentationUrl = 'https://handelsregister.ai/documentation';
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description: 'Your Handelsregister.ai API key',
    },
    {
      displayName: 'API URL',
      name: 'apiUrl',
      type: 'string',
      default: 'https://handelsregister.ai',
      description: 'The base URL for the Handelsregister.ai API',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'x-api-key': '={{$credentials.apiKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.apiUrl || "https://handelsregister.ai"}}',
      url: '/api/v1/search-organizations',
      method: 'GET',
      headers: {
        'x-api-key': '={{$credentials.apiKey}}',
      },
      qs: {
        q: 'test',
        limit: 1,
      },
    },
  };
}
