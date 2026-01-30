/**
 * Location Mapper Service
 * 
 * Maps location strings from account_based_in to ISO 3166-1 alpha-2 country codes.
 * Handles both country-level and region-level locations.
 */

export interface LocationMapping {
  location: string;
  country_codes: string[]; // ISO 3166-1 alpha-2 codes (can be multiple for regions)
  region_type: 'country' | 'region';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Comprehensive location to country code mappings
 * Includes countries, regions, and common variations
 */
const LOCATION_MAPPINGS: Record<string, LocationMapping> = {
  // === COUNTRIES ===
  
  // Major Countries
  'India': { location: 'India', country_codes: ['IN'], region_type: 'country', confidence: 'high' },
  'United States': { location: 'United States', country_codes: ['US'], region_type: 'country', confidence: 'high' },
  'United States of America': { location: 'United States', country_codes: ['US'], region_type: 'country', confidence: 'high' },
  'USA': { location: 'United States', country_codes: ['US'], region_type: 'country', confidence: 'high' },
  'US': { location: 'United States', country_codes: ['US'], region_type: 'country', confidence: 'high' },
  
  'United Kingdom': { location: 'United Kingdom', country_codes: ['GB'], region_type: 'country', confidence: 'high' },
  'UK': { location: 'United Kingdom', country_codes: ['GB'], region_type: 'country', confidence: 'high' },
  'Great Britain': { location: 'United Kingdom', country_codes: ['GB'], region_type: 'country', confidence: 'high' },
  
  'Canada': { location: 'Canada', country_codes: ['CA'], region_type: 'country', confidence: 'high' },
  'Australia': { location: 'Australia', country_codes: ['AU'], region_type: 'country', confidence: 'high' },
  'Germany': { location: 'Germany', country_codes: ['DE'], region_type: 'country', confidence: 'high' },
  'France': { location: 'France', country_codes: ['FR'], region_type: 'country', confidence: 'high' },
  'Japan': { location: 'Japan', country_codes: ['JP'], region_type: 'country', confidence: 'high' },
  'China': { location: 'China', country_codes: ['CN'], region_type: 'country', confidence: 'high' },
  'Brazil': { location: 'Brazil', country_codes: ['BR'], region_type: 'country', confidence: 'high' },
  'Mexico': { location: 'Mexico', country_codes: ['MX'], region_type: 'country', confidence: 'high' },
  'Spain': { location: 'Spain', country_codes: ['ES'], region_type: 'country', confidence: 'high' },
  'Italy': { location: 'Italy', country_codes: ['IT'], region_type: 'country', confidence: 'high' },
  'Netherlands': { location: 'Netherlands', country_codes: ['NL'], region_type: 'country', confidence: 'high' },
  'Sweden': { location: 'Sweden', country_codes: ['SE'], region_type: 'country', confidence: 'high' },
  'Switzerland': { location: 'Switzerland', country_codes: ['CH'], region_type: 'country', confidence: 'high' },
  'Singapore': { location: 'Singapore', country_codes: ['SG'], region_type: 'country', confidence: 'high' },
  'South Korea': { location: 'South Korea', country_codes: ['KR'], region_type: 'country', confidence: 'high' },
  'Taiwan': { location: 'Taiwan', country_codes: ['TW'], region_type: 'country', confidence: 'high' },
  'Indonesia': { location: 'Indonesia', country_codes: ['ID'], region_type: 'country', confidence: 'high' },
  'Philippines': { location: 'Philippines', country_codes: ['PH'], region_type: 'country', confidence: 'high' },
  'Thailand': { location: 'Thailand', country_codes: ['TH'], region_type: 'country', confidence: 'high' },
  'Vietnam': { location: 'Vietnam', country_codes: ['VN'], region_type: 'country', confidence: 'high' },
  'Malaysia': { location: 'Malaysia', country_codes: ['MY'], region_type: 'country', confidence: 'high' },
  'Pakistan': { location: 'Pakistan', country_codes: ['PK'], region_type: 'country', confidence: 'high' },
  'Bangladesh': { location: 'Bangladesh', country_codes: ['BD'], region_type: 'country', confidence: 'high' },
  'Sri Lanka': { location: 'Sri Lanka', country_codes: ['LK'], region_type: 'country', confidence: 'high' },
  'Nepal': { location: 'Nepal', country_codes: ['NP'], region_type: 'country', confidence: 'high' },
  'Israel': { location: 'Israel', country_codes: ['IL'], region_type: 'country', confidence: 'high' },
  'United Arab Emirates': { location: 'United Arab Emirates', country_codes: ['AE'], region_type: 'country', confidence: 'high' },
  'UAE': { location: 'United Arab Emirates', country_codes: ['AE'], region_type: 'country', confidence: 'high' },
  'Saudi Arabia': { location: 'Saudi Arabia', country_codes: ['SA'], region_type: 'country', confidence: 'high' },
  'Turkey': { location: 'Turkey', country_codes: ['TR'], region_type: 'country', confidence: 'high' },
  'Poland': { location: 'Poland', country_codes: ['PL'], region_type: 'country', confidence: 'high' },
  'Belgium': { location: 'Belgium', country_codes: ['BE'], region_type: 'country', confidence: 'high' },
  'Austria': { location: 'Austria', country_codes: ['AT'], region_type: 'country', confidence: 'high' },
  'Denmark': { location: 'Denmark', country_codes: ['DK'], region_type: 'country', confidence: 'high' },
  'Norway': { location: 'Norway', country_codes: ['NO'], region_type: 'country', confidence: 'high' },
  'Finland': { location: 'Finland', country_codes: ['FI'], region_type: 'country', confidence: 'high' },
  'Ireland': { location: 'Ireland', country_codes: ['IE'], region_type: 'country', confidence: 'high' },
  'Portugal': { location: 'Portugal', country_codes: ['PT'], region_type: 'country', confidence: 'high' },
  'Greece': { location: 'Greece', country_codes: ['GR'], region_type: 'country', confidence: 'high' },
  'Argentina': { location: 'Argentina', country_codes: ['AR'], region_type: 'country', confidence: 'high' },
  'Chile': { location: 'Chile', country_codes: ['CL'], region_type: 'country', confidence: 'high' },
  'Colombia': { location: 'Colombia', country_codes: ['CO'], region_type: 'country', confidence: 'high' },
  'South Africa': { location: 'South Africa', country_codes: ['ZA'], region_type: 'country', confidence: 'high' },
  'Nigeria': { location: 'Nigeria', country_codes: ['NG'], region_type: 'country', confidence: 'high' },
  'Kenya': { location: 'Kenya', country_codes: ['KE'], region_type: 'country', confidence: 'high' },
  'Egypt': { location: 'Egypt', country_codes: ['EG'], region_type: 'country', confidence: 'high' },
  'New Zealand': { location: 'New Zealand', country_codes: ['NZ'], region_type: 'country', confidence: 'high' },
  'Russia': { location: 'Russia', country_codes: ['RU'], region_type: 'country', confidence: 'high' },
  
  // === REGIONS ===
  
  'South Asia': {
    location: 'South Asia',
    country_codes: ['IN', 'PK', 'BD', 'LK', 'NP', 'BT', 'MV', 'AF'],
    region_type: 'region',
    confidence: 'high'
  },
  
  'Southeast Asia': {
    location: 'Southeast Asia',
    country_codes: ['SG', 'MY', 'TH', 'VN', 'PH', 'ID', 'MM', 'KH', 'LA'],
    region_type: 'region',
    confidence: 'high'
  },
  
  'East Asia': {
    location: 'East Asia',
    country_codes: ['CN', 'JP', 'KR', 'TW', 'HK', 'MN'],
    region_type: 'region',
    confidence: 'high'
  },
  
  'North America': {
    location: 'North America',
    country_codes: ['US', 'CA', 'MX'],
    region_type: 'region',
    confidence: 'high'
  },
  
  'Latin America': {
    location: 'Latin America',
    country_codes: ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU'],
    region_type: 'region',
    confidence: 'medium'
  },
  
  'South America': {
    location: 'South America',
    country_codes: ['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY'],
    region_type: 'region',
    confidence: 'high'
  },
  
  'Europe': {
    location: 'Europe',
    country_codes: ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'CH', 'PL', 'BE', 'AT', 'DK', 'NO', 'FI', 'IE', 'PT', 'GR', 'RU'],
    region_type: 'region',
    confidence: 'medium'
  },
  
  'Western Europe': {
    location: 'Western Europe',
    country_codes: ['GB', 'FR', 'DE', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'IE', 'PT'],
    region_type: 'region',
    confidence: 'high'
  },
  
  'Eastern Europe': {
    location: 'Eastern Europe',
    country_codes: ['PL', 'RU', 'CZ', 'HU', 'RO', 'BG', 'SK', 'HR', 'RS'],
    region_type: 'region',
    confidence: 'medium'
  },
  
  'Middle East': {
    location: 'Middle East',
    country_codes: ['AE', 'SA', 'IL', 'TR', 'EG', 'IQ', 'IR', 'JO', 'LB', 'KW', 'QA'],
    region_type: 'region',
    confidence: 'medium'
  },
  
  'Africa': {
    location: 'Africa',
    country_codes: ['ZA', 'NG', 'KE', 'EG', 'GH', 'ET', 'TZ', 'UG', 'DZ', 'MA'],
    region_type: 'region',
    confidence: 'low'
  },
  
  'Asia': {
    location: 'Asia',
    country_codes: ['IN', 'CN', 'JP', 'KR', 'ID', 'PK', 'BD', 'PH', 'VN', 'TH', 'MY', 'SG'],
    region_type: 'region',
    confidence: 'low'
  },
  
  'Americas': {
    location: 'Americas',
    country_codes: ['US', 'CA', 'MX', 'BR', 'AR', 'CO', 'CL'],
    region_type: 'region',
    confidence: 'low'
  },
  
  'Oceania': {
    location: 'Oceania',
    country_codes: ['AU', 'NZ', 'FJ', 'PG'],
    region_type: 'region',
    confidence: 'medium'
  },
};

/**
 * Map a location string to country codes
 * 
 * @param location - Location string from account_based_in
 * @returns LocationMapping with country codes and metadata
 */
export function mapLocationToCountryCodes(location: string): LocationMapping {
  if (!location || typeof location !== 'string') {
    return {
      location: 'Unknown',
      country_codes: [],
      region_type: 'region',
      confidence: 'low',
    };
  }
  
  const normalized = location.trim();
  
  // Direct match (case-sensitive)
  if (LOCATION_MAPPINGS[normalized]) {
    return LOCATION_MAPPINGS[normalized];
  }
  
  // Case-insensitive match
  const caseInsensitiveMatch = Object.values(LOCATION_MAPPINGS).find(
    m => m.location.toLowerCase() === normalized.toLowerCase()
  );
  if (caseInsensitiveMatch) {
    return caseInsensitiveMatch;
  }
  
  // Try to find partial match (for variations like "United States Android App")
  const partialMatch = Object.keys(LOCATION_MAPPINGS).find(
    key => normalized.toLowerCase().includes(key.toLowerCase()) ||
           key.toLowerCase().includes(normalized.toLowerCase())
  );
  if (partialMatch) {
    return LOCATION_MAPPINGS[partialMatch];
  }
  
  // No match found - return as-is with low confidence
  return {
    location: normalized,
    country_codes: [],
    region_type: 'region',
    confidence: 'low',
  };
}

/**
 * Get all mapped locations (for debugging/testing)
 */
export function getAllMappedLocations(): LocationMapping[] {
  return Object.values(LOCATION_MAPPINGS);
}

/**
 * Check if a location is mapped
 */
export function isLocationMapped(location: string): boolean {
  const mapping = mapLocationToCountryCodes(location);
  return mapping.confidence !== 'low' || mapping.country_codes.length > 0;
}

