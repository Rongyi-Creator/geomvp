// ── Alignment System — Type Definitions ──

export interface OpeningHour {
  dayOfWeek: string;  // "Monday"
  opens: string;      // "09:00"
  closes: string;     // "17:00"
}

export interface ClientProfile {
  id: string;
  name: string;
  domain: string;
  address: {
    street: string;
    zip: string;
    city: string;
    country: string;
  };
  phone: string;
  email: string;
  industry: string;
  hours: OpeningHour[];
  services: string[];
}

// ── Platform Results ──

export interface GoogleResult {
  exists: boolean;
  name: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  hours: string | null;
  mapsUrl: string | null;
  placeId: string | null;
  categories: string[];
  claimed: boolean;
  error?: string;
}

export interface TrustpilotResult {
  exists: boolean;
  claimed: boolean;
  rating: number | null;
  reviewCount: number | null;
  profileUrl: string | null;
  error?: string;
}

export interface KrakResult {
  exists: boolean;
  name: string | null;
  address: string | null;
  phone: string | null;
  listingUrl: string | null;
  error?: string;
}

export interface GuleSiderResult {
  exists: boolean;
  name: string | null;
  address: string | null;
  phone: string | null;
  listingUrl: string | null;
  error?: string;
}

export interface FacebookResult {
  exists: boolean;
  pageUrl: string | null;
  name: string | null;
  napStatus: 'matched' | 'needs_manual_check' | 'not_found';
  error?: string;
}

export interface WebsiteResult {
  hasJsonLd: boolean;
  jsonLdData: object | null;
  hasRobotsTxt: boolean;
  hasSitemap: boolean;
  sslValid: boolean;
  napFromSite: {
    name: string | null;
    address: string | null;
    phone: string | null;
  };
  error?: string;
}

export interface AlignmentCheckResult {
  clientId: string;
  checkedAt: string;
  canonical: ClientProfile;
  platforms: {
    google: GoogleResult;
    trustpilot: TrustpilotResult;
    krak: KrakResult;
    guleSider: GuleSiderResult;
    facebook: FacebookResult;
    website: WebsiteResult;
  };
}

// ── NAP Comparison ──

export type MatchLevel = 'exact' | 'equivalent' | 'minor_diff' | 'major_diff' | 'missing';

export interface NapComparison {
  platform: string;
  field: 'name' | 'address' | 'phone' | 'hours';
  canonical: string;
  platformValue: string;
  match: MatchLevel;
  diffDescription: string;   // Danish
  recommendation: string;    // Danish
}

// ── Scoring ──

export interface ScoreGrade {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  label_da: string;
  color: string;
}

export interface ScoreBreakdown {
  coverage: number;      // 0–40
  consistency: number;   // 0–40
  signals: number;       // 0–20
  total: number;         // 0–100
  grade: ScoreGrade;
}

// ── Report ──

export interface PlatformStatus {
  id: string;
  name_da: string;
  icon: string;
  status: 'ok' | 'warning' | 'missing' | 'error' | 'unable_to_check';
  statusText_da: string;
  issues: string[];
  actionUrl: string | null;
  actionText_da: string | null;
  detailUrl: string | null;  // Google Maps URL, Trustpilot profile URL, etc.
}

export interface PrioritizedAction {
  priority: number;
  action_da: string;
  timeEstimate_da: string;
  impactText_da: string;
  url: string;
  guideUrl: string | null;
}

export interface AlignmentReport {
  clientId: string;
  generatedAt: string;
  runType: 'day1' | 'day4' | 'biweekly' | 'manual';
  client: { name: string; domain: string };
  score: ScoreBreakdown;
  platforms: PlatformStatus[];
  inconsistencies: NapComparison[];
  prioritizedActions: PrioritizedAction[];
  sameAsUpdated: string[];
}

export interface ScoreHistoryEntry {
  date: string;
  runType: string;
  total: number;
  coverage: number;
  consistency: number;
  signals: number;
}

export interface ScoreHistory {
  clientId: string;
  history: ScoreHistoryEntry[];
}
