import { ICredentialType, INodeProperties, ICredentialTestRequest } from 'n8n-workflow';

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

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.apiUrl || "https://handelsregister.ai"}}',
      url: '/api/v1/search-organizations',
      method: 'GET',
      qs: {
        api_key: '={{$credentials.apiKey}}',
        q: 'test',
        limit: 1,
      },
    },
  };
}
