# n8n-nodes-handelsregister-ai

This is an n8n community node that allows you to interact with the [Handelsregister.ai](https://handelsregister.ai) API to query German business registry data.

## Installation

### Community Node

1. In n8n, go to **Settings** > **Community Nodes**
2. Click **Install**
3. Enter `n8n-nodes-handelsregister-ai`
4. Click **Install**

### Manual Installation

```bash
npm install n8n-nodes-handelsregister-ai
```

## Features

- **Fetch Organization**: Get comprehensive information about a German company including financial data, related persons, and publications
- **Search Organizations**: Search German companies with filters and pagination
- **Fetch Document**: Download official PDF documents from the German business registry

## Setup

1. Get your API key from [Handelsregister.ai](https://handelsregister.ai)
2. In n8n, add credentials:
   - Go to **Credentials** > **New**
   - Select **Handelsregister.ai API**
   - Enter your API key
   - Save the credentials

## Usage

### Fetch Organization

Get comprehensive information about a German company:
- **Query**: Company name, registration number or search query (e.g., "Konux GmbH aus München")
- **Features**: Select additional data to include:
  - Financial KPI (1 Credit)
  - Balance Sheet Accounts (3 Credits)
  - Profit and Loss Account (3 Credits)
  - Related Persons (2 Credits)
  - Publications (1 Credit)
  - News (10 Credits)
  - Insolvency Publications (1 Credit)
  - Annual Financial Statements (5 Credits)
- **AI Mode**: Enable AI-powered search for better results (enabled by default)

### Search Organizations

Search German companies with filters and pagination:
- **Query**: Search query (minimum 2 characters, e.g., "Konux")
- **Additional Fields**:
  - Skip: Number of results to skip
  - Limit: Results per page (1-100)
  - Postal Code Filter: Filter by postal code

### Fetch Document

Download official PDF documents from the German business registry:
- **Company ID**: Unique company entity ID from search results
- **Document Type**: 
  - Shareholders List
  - Current Extract (AD)
  - Historical Extract (CD)

## Example Workflows

### Fetch Organization with Features
```json
{
  "nodes": [
    {
      "parameters": {
        "operation": "fetchOrganization",
        "q": "Konux GmbH aus München",
        "features": ["financial_kpi", "related_persons"],
        "ai_search": true
      },
      "name": "handelsregister.ai",
      "type": "n8n-nodes-handelsregister-ai.handelsregisterAi",
      "typeVersion": 1,
      "position": [250, 300]
    }
  ]
}
```

### Search Organizations with Filters
```json
{
  "nodes": [
    {
      "parameters": {
        "operation": "searchOrganizations",
        "q": "tech",
        "additionalFields": {
          "limit": 20,
          "postal_code": "80331"
        }
      },
      "name": "Search Organizations",
      "type": "n8n-nodes-handelsregister-ai.handelsregisterAi",
      "typeVersion": 1,
      "position": [250, 300]
    }
  ]
}
```

### Fetch Document Workflow
```json
{
  "nodes": [
    {
      "parameters": {
        "operation": "fetchDocument",
        "company_id": "{{ $json.entity_id }}",
        "document_type": "shareholders_list"
      },
      "name": "Fetch Document",
      "type": "n8n-nodes-handelsregister-ai.handelsregisterAi",
      "typeVersion": 1,
      "position": [450, 300]
    }
  ]
}
```

### Batch Company Processing
Use this workflow to process multiple companies from a spreadsheet or database:

1. **Spreadsheet/Database Node** → Read company names
2. **handelsregister.ai Node** → Use `searchOrganizations` to find companies
3. **Filter Node** → Filter results based on criteria
4. **handelsregister.ai Node** → Use `fetchOrganization` to get detailed data
5. **Output Node** → Save results to database or file

## Development

```bash
# Install dependencies
npm install

# Build the node
npm run build

# Run in development mode
npm run dev
```

## License

[MIT](LICENSE.md)

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/Handelsregister-AI/n8n-nodes-handelsregister-ai).