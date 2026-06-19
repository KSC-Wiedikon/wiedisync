// ISO 4217 currency codes for the expense form's searchable dropdown.
// Common ones (for a Swiss club) are floated to the top; the rest follow
// alphabetically by code. Names stay in English (reference data, not UI copy).

interface Currency {
  code: string
  name: string
}

// Most-used first — these surface at the top of the dropdown.
const COMMON: Currency[] = [
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US dollar' },
  { code: 'GBP', name: 'Pound sterling' },
]

// Remaining currencies, alphabetical by code.
const OTHERS: Currency[] = [
  { code: 'AED', name: 'UAE dirham' },
  { code: 'ALL', name: 'Albanian lek' },
  { code: 'ARS', name: 'Argentine peso' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'BAM', name: 'Bosnia-Herzegovina convertible mark' },
  { code: 'BGN', name: 'Bulgarian lev' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'CLP', name: 'Chilean peso' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'COP', name: 'Colombian peso' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'HRK', name: 'Croatian kuna' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'ILS', name: 'Israeli new shekel' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'ISK', name: 'Icelandic króna' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'RSD', name: 'Serbian dinar' },
  { code: 'RUB', name: 'Russian ruble' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'TWD', name: 'New Taiwan dollar' },
  { code: 'UAH', name: 'Ukrainian hryvnia' },
  { code: 'VND', name: 'Vietnamese đồng' },
  { code: 'ZAR', name: 'South African rand' },
]

export const CURRENCIES: Currency[] = [...COMMON, ...OTHERS]

/** Options for SearchableSelect — label "CHF — Swiss franc" (searchable by code or name). */
export const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} — ${c.name}`,
}))
