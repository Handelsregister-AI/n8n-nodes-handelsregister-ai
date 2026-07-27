import {
  IAuthenticate,
  ICredentialType,
  INodeProperties,
  ICredentialTestRequest,
} from 'n8n-workflow';

export class HandelsregisterAiApi implements ICredentialType {
  name = 'handelsregisterAiApi';
  displayName = 'Handelsregister.ai API';
  documentationUrl = 'https://handelsregister.ai/documentation';
  properties: INodeProperties[] = [
    {
      displayName: 'Authentication Method',
      name: 'authenticationMethod',
      type: 'options',
      options: [
        {
          name: 'API Key',
          value: 'apiKey',
        },
        {
          name: 'Bearer Token',
          value: 'bearerToken',
        },
      ],
      default: 'apiKey',
      description: 'API keys and Bearer tokens work with every API endpoint',
    },
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
      displayOptions: {
        show: {
          authenticationMethod: ['apiKey'],
        },
      },
    },
    {
      displayName: 'Bearer Token',
      name: 'bearerToken',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description: 'A Bearer token created through the Handelsregister.ai API',
      displayOptions: {
        show: {
          authenticationMethod: ['bearerToken'],
        },
      },
    },
    {
      displayName: 'API URL',
      name: 'apiUrl',
      type: 'string',
      default: 'https://handelsregister.ai',
      description: 'The base URL for the Handelsregister.ai API',
    },
  ];

  authenticate: IAuthenticate = async (credentials, requestOptions) => {
    const authenticationMethod =
      (credentials.authenticationMethod as string | undefined) || 'apiKey';
    requestOptions.headers = requestOptions.headers ?? {};

    if (authenticationMethod === 'bearerToken') {
      requestOptions.headers.Authorization = `Bearer ${String(credentials.bearerToken || '')}`;
    } else {
      requestOptions.headers['x-api-key'] = String(credentials.apiKey || '');
    }

    return requestOptions;
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.apiUrl || "https://handelsregister.ai"}}',
      url: '/api/v1/search-organizations',
      method: 'GET',
      qs: {
        q: 'test',
        limit: 1,
      },
    },
  };
}
