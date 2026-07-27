import type { INodeProperties } from 'n8n-workflow';

type RangeDescription = {
  displayName: string;
  name: string;
  unit?: string;
  ratio?: boolean;
};

const rangeDescriptions: RangeDescription[] = [
  { displayName: 'Employee Count', name: 'emp_count' },
  { displayName: 'Balance Sheet: Assets Total', name: 'bs_assets_total', unit: 'EUR' },
  { displayName: 'Balance Sheet: Equity Total', name: 'bs_equity_total', unit: 'EUR' },
  {
    displayName: 'Balance Sheet: Liabilities Total',
    name: 'bs_liabilities_total',
    unit: 'EUR',
  },
  {
    displayName: 'Balance Sheet: Cash and Equivalents',
    name: 'bs_cash_and_equivalents',
    unit: 'EUR',
  },
  {
    displayName: 'Balance Sheet: Cash to Liabilities',
    name: 'bs_cash_to_liabilities',
    ratio: true,
  },
  { displayName: 'Balance Sheet: Equity Ratio', name: 'bs_equity_ratio', ratio: true },
  {
    displayName: 'Balance Sheet: Debt to Assets',
    name: 'bs_debt_to_assets',
    ratio: true,
  },
  { displayName: 'Profit and Loss: Revenue', name: 'pl_revenue', unit: 'EUR' },
  { displayName: 'Profit and Loss: Net Income', name: 'pl_net_income', unit: 'EUR' },
  { displayName: 'Profit and Loss: EBIT', name: 'pl_ebit', unit: 'EUR' },
];

function rangeFields(description: RangeDescription): INodeProperties[] {
  const suffix = description.unit ? ` (${description.unit})` : description.ratio ? ' (0–1)' : '';
  const typeOptions = description.ratio
    ? { minValue: 0, maxValue: 1, numberPrecision: 6 }
    : { numberPrecision: 6 };

  return [
    {
      displayName: `${description.displayName} Minimum${suffix}`,
      name: `${description.name}_gte`,
      type: 'number',
      typeOptions,
      default: '',
      description: `Minimum value for ${description.displayName}`,
    },
    {
      displayName: `${description.displayName} Maximum${suffix}`,
      name: `${description.name}_lte`,
      type: 'number',
      typeOptions,
      default: '',
      description: `Maximum value for ${description.displayName}`,
    },
  ];
}

const searchAdditionalFields: INodeProperties[] = [
  {
    displayName: 'Skip',
    name: 'skip',
    type: 'number',
    typeOptions: { minValue: 0 },
    default: 0,
    description: 'Number of matching organizations to skip',
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    typeOptions: { minValue: 1, maxValue: 30 },
    default: 10,
    description: 'Results per API page (maximum 30)',
  },
  {
    displayName: 'Registration Date From',
    name: 'registration_date_from',
    type: 'string',
    default: '',
    placeholder: 'e.g., 2024-01-01',
    description: 'Earliest registration date in YYYY-MM-DD format',
  },
  {
    displayName: 'Registration Date To',
    name: 'registration_date_to',
    type: 'string',
    default: '',
    placeholder: 'e.g., 2026-12-31',
    description: 'Latest registration date in YYYY-MM-DD format',
  },
  {
    displayName: 'Legal Form Codes',
    name: 'legal_form_code',
    type: 'string',
    default: '',
    placeholder: 'e.g., GmbH, UG',
    description: 'One or more legal-form codes separated by commas',
  },
  {
    displayName: 'Industry Codes',
    name: 'industry_code',
    type: 'string',
    default: '',
    placeholder: 'e.g., 62.01, 62.02',
    description: 'One or more NACE/WZ industry codes separated by commas',
  },
  {
    displayName: 'Industry Scheme',
    name: 'industry_scheme',
    type: 'string',
    default: '',
    placeholder: 'e.g., WZ2025',
    description: 'Classification scheme used by Industry Codes',
  },
  {
    displayName: 'Activity Status',
    name: 'active',
    type: 'options',
    options: [
      { name: 'Any', value: '' },
      { name: 'Active Only', value: 'true' },
      { name: 'Inactive Only', value: 'false' },
    ],
    default: '',
    description: 'Filter by active or inactive organizations',
  },
  {
    displayName: 'Postal Code Filter',
    name: 'postal_code',
    type: 'string',
    default: '',
    placeholder: 'e.g., 80331',
    description: 'German five-digit postal code',
  },
  {
    displayName: 'City',
    name: 'city',
    type: 'string',
    default: '',
    description: 'City name',
  },
  {
    displayName: 'State',
    name: 'state',
    type: 'string',
    default: '',
    placeholder: 'e.g., Bayern',
    description: 'German federal state',
  },
  {
    displayName: 'Latitude',
    name: 'latitude',
    type: 'number',
    typeOptions: { minValue: -90, maxValue: 90, numberPrecision: 7 },
    default: '',
    description: 'WGS84 latitude; longitude is also required',
  },
  {
    displayName: 'Longitude',
    name: 'longitude',
    type: 'number',
    typeOptions: { minValue: -180, maxValue: 180, numberPrecision: 7 },
    default: '',
    description: 'WGS84 longitude; latitude is also required',
  },
  {
    displayName: 'Location Maximum Distance (Km)',
    name: 'location_max_distance_km',
    type: 'number',
    typeOptions: { minValue: 1, maxValue: 100 },
    default: '',
    description: 'Search radius from the supplied coordinates',
  },
  {
    displayName: 'Registration Types',
    name: 'registration_type',
    type: 'multiOptions',
    options: [
      { name: 'Cooperative Register (GnR)', value: 'GnR' },
      { name: 'Commercial Register A (HRA)', value: 'HRA' },
      { name: 'Commercial Register B (HRB)', value: 'HRB' },
      { name: 'Partnership Register (PR)', value: 'PR' },
      { name: 'Register of Associations (VR)', value: 'VR' },
    ],
    default: [],
    description: 'One or more German register types',
  },
  {
    displayName: 'Registration Authority Name',
    name: 'registration_authority_name',
    type: 'string',
    default: '',
    placeholder: 'e.g., München',
    description: 'Court or registration authority name',
  },
  {
    displayName: 'Registration Number',
    name: 'registration_number',
    type: 'string',
    default: '',
    placeholder: 'e.g., HRB 12345',
    description: 'Company registration number',
  },
  {
    displayName: 'Company Size Category',
    name: 'company_size_category',
    type: 'options',
    options: [
      { name: 'Any', value: '' },
      { name: 'Micro', value: 'micro' },
      { name: 'Small', value: 'small' },
      { name: 'Medium', value: 'medium' },
      { name: 'Large', value: 'large' },
    ],
    default: '',
    description: 'EU-style company size category',
  },
  ...rangeDescriptions.flatMap(rangeFields),
  {
    displayName: 'Advanced Filters JSON',
    name: 'filtersJson',
    type: 'json',
    default: '',
    placeholder: '{"postal_code":"80331"}',
    description:
      'Optional raw filters object for forward compatibility. Structured fields override matching JSON keys.',
  },
];

export const nodeProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    options: [
      {
        name: 'Fetch Document',
        value: 'fetchDocument',
        description: 'Download an official registry PDF or XML document',
        action: 'Fetch a document',
      },
      {
        name: 'Fetch Organization',
        value: 'fetchOrganization',
        description: 'Get comprehensive information about a German company',
        action: 'Fetch organization details',
      },
      {
        name: 'Fetch Person',
        value: 'fetchPerson',
        description: 'Fetch a person profile by name and company context',
        action: 'Fetch person details',
      },
      {
        name: 'Search Organizations',
        value: 'searchOrganizations',
        description: 'Search German companies with filters and pagination',
        action: 'Search organizations',
      },
    ],
    default: 'fetchOrganization',
  },
  {
    displayName: 'Query',
    name: 'q',
    type: 'string',
    default: '',
    placeholder: 'e.g., Konux GmbH aus München',
    description: 'Company name, registration number, entity ID, or search query',
    displayOptions: { show: { operation: ['fetchOrganization'] } },
    required: true,
  },
  {
    displayName: 'Features',
    name: 'features',
    type: 'multiOptions',
    displayOptions: { show: { operation: ['fetchOrganization'] } },
    options: [
      {
        name: 'Annual Financial Statements',
        value: 'annual_financial_statements',
        description: '5 credits when data is returned - reports in Markdown',
      },
      {
        name: 'Annual Financial Statements (HTML)',
        value: 'annual_financial_statements__html',
        description: '5 credits when data is returned - reports in HTML',
      },
      {
        name: 'Balance Sheet Accounts',
        value: 'balance_sheet_accounts',
        description: '3 credits when data is returned - hierarchical balance-sheet data',
      },
      {
        name: 'Financial KPI',
        value: 'financial_kpi',
        description: '1 credit when data is returned - annual financial KPIs',
      },
      {
        name: 'Insolvency Publications',
        value: 'insolvency_publications',
        description: '5 credits when data is returned - insolvency court publications',
      },
      {
        name: 'Mergers and Acquisitions',
        value: 'mergers_and_acquisitions',
        description: '20 credits when data is returned - M&A and enterprise agreements',
      },
      {
        name: 'News',
        value: 'news',
        description: '10 credits when data is returned - company news',
      },
      {
        name: 'Profit and Loss Account',
        value: 'profit_and_loss_account',
        description: '3 credits when data is returned - detailed P&L statements',
      },
      {
        name: 'Publications',
        value: 'publications',
        description: '1 credit when data is returned - returned under the history response key',
      },
      {
        name: 'Related Persons',
        value: 'related_persons',
        description: '2 credits when data is returned - directors and representation schemes',
      },
      {
        name: 'Shareholders',
        value: 'shareholders',
        description: '5 credits when current shareholder data is returned',
      },
      {
        name: 'Shareholdings',
        value: 'shareholdings',
        description: '5 credits when data is returned - outbound holdings',
      },
      {
        name: 'UBOs (Ultimate Beneficial Owners)',
        value: 'ubos',
        description: '10 credits when data is returned - beneficial ownership',
      },
      {
        name: 'Website Content',
        value: 'website_content',
        description: '0 feature credits - requires AI Mode',
      },
    ],
    default: [],
    description: 'Additional organization data to include',
  },
  {
    displayName: 'AI Mode',
    name: 'ai_search',
    type: 'boolean',
    default: true,
    description: 'Whether to enable AI-assisted matching (+20 credits)',
    displayOptions: { show: { operation: ['fetchOrganization'] } },
  },
  {
    displayName: 'Realtime Mode',
    name: 'realtime_mode',
    type: 'boolean',
    default: false,
    description:
      'Whether to query the live register (+10 credits after a successful live lookup). Incompatible with Related Persons and Publications.',
    displayOptions: { show: { operation: ['fetchOrganization'] } },
  },
  {
    displayName: 'Person Name',
    name: 'person_q',
    type: 'string',
    default: '',
    placeholder: 'e.g., Erika Mustermann',
    description: 'Full name of the person (minimum 2 characters)',
    displayOptions: { show: { operation: ['fetchPerson'] } },
    required: true,
  },
  {
    displayName: 'Organization',
    name: 'organization_q',
    type: 'string',
    default: '',
    placeholder: 'e.g., Musterfirma GmbH',
    description: 'Company context used to disambiguate the person',
    displayOptions: { show: { operation: ['fetchPerson'] } },
    required: true,
  },
  {
    displayName: 'Features',
    name: 'personFeatures',
    type: 'multiOptions',
    displayOptions: { show: { operation: ['fetchPerson'] } },
    options: [
      {
        name: 'Shareholdings',
        value: 'shareholdings',
        description: '5 credits when data is returned - shareholdings across companies',
      },
    ],
    default: [],
    description: 'Optional person data to include',
  },
  {
    displayName: 'Query',
    name: 'q',
    type: 'string',
    default: '',
    placeholder: 'e.g., Konux',
    description: 'Optional when at least one search filter is configured',
    displayOptions: { show: { operation: ['searchOrganizations'] } },
  },
  {
    displayName: 'AI Mode',
    name: 'searchAiMode',
    type: 'boolean',
    default: false,
    description: 'Whether to enable AI-assisted organization search (5 credits)',
    displayOptions: { show: { operation: ['searchOrganizations'] } },
  },
  {
    displayName: 'Return All',
    name: 'returnAll',
    type: 'boolean',
    default: false,
    description: 'Whether to fetch every result by requesting successive pages of 30',
    displayOptions: { show: { operation: ['searchOrganizations'] } },
  },
  {
    displayName: 'Maximum Results',
    name: 'maxResults',
    type: 'number',
    typeOptions: { minValue: 0 },
    default: 0,
    description:
      'Maximum results to return when Return All is enabled. Use 0 for no client-side cap.',
    displayOptions: {
      show: { operation: ['searchOrganizations'], returnAll: [true] },
    },
  },
  {
    displayName: 'Output',
    name: 'searchOutput',
    type: 'options',
    options: [
      {
        name: 'One Item per Organization',
        value: 'split',
        description: 'Return each matching organization as a separate n8n item',
      },
      {
        name: 'Complete API Response',
        value: 'response',
        description: 'Return the results, total, and metadata in one item',
      },
    ],
    default: 'split',
    displayOptions: { show: { operation: ['searchOrganizations'] } },
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { operation: ['searchOrganizations'] } },
    options: searchAdditionalFields,
  },
  {
    displayName: 'Company ID',
    name: 'company_id',
    type: 'string',
    default: '',
    placeholder: 'e.g., 20a1510e88cd2e9b166db4d0bc5d563d',
    description: 'Unique organization entity ID from search results',
    displayOptions: { show: { operation: ['fetchDocument'] } },
    required: true,
  },
  {
    displayName: 'Document Type',
    name: 'document_type',
    type: 'options',
    options: [
      {
        name: 'Articles of Association',
        value: 'articles_of_association',
        description: 'Gesellschaftsvertrag, Satzung, or founding articles (PDF)',
      },
      { name: 'Current Extract (AD)', value: 'AD', description: 'Current data extract (PDF)' },
      {
        name: 'Historical Extract (CD)',
        value: 'CD',
        description: 'Chronological or historical data extract (PDF)',
      },
      {
        name: 'Shareholders List',
        value: 'shareholders_list',
        description: 'Gesellschafterliste (PDF)',
      },
      {
        name: 'Structured Information (SI)',
        value: 'SI',
        description: 'Structured register information (XML)',
      },
    ],
    default: 'shareholders_list',
    displayOptions: { show: { operation: ['fetchDocument'] } },
    required: true,
  },
];
