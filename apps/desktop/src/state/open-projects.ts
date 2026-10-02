const STORAGE_KEY = 'itstudio.openProjects';

export function readOpenProjects(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function writeOpenProjects(projectIds: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projectIds));
  } catch {
    // Open tabs are a convenience; storage may be unavailable in restricted webviews.
  }
}
