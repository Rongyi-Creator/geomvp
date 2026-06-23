// ── NAP Normalization Utilities ──

export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  // Strip Danish country code prefix (45 + 8 digits = 10 digits)
  if (digits.startsWith('45') && digits.length === 10) {
    digits = digits.slice(2);
  }
  return digits; // 8-digit Danish number
}

export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,;:]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bsal\b/gi, '')
    .replace(/\betage\b/gi, '')
    .replace(/\bst\b/gi, '')     // "stuen" floor abbreviation
    .replace(/\btv\b/gi, '')     // "til venstre"
    .replace(/\bth\b/gi, '')     // "til højre"
    .trim();
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Levenshtein distance for fuzzy name matching
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function nameMatches(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return levenshtein(na, nb) <= 3;
}
