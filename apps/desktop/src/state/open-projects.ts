const STORAGE_KEY = 'itstudio.openProjects';
const ACTIVE_STORAGE_KEY = 'itstudio.activeProject';

export function readActiveProject(): string | null | undefined {
  try {
    const stored = localStorage.getItem(ACTIVE_STORAGE_KEY);
    if (stored === null) return undefined;
    const value: unknown = JSON.parse(stored);
    return value === null || typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function readOpenProjects(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function writeOpenProjects(projectIds: readonly string[], activeId: string | null): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projectIds));
    localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(activeId));
  } catch {
    // Open tabs are a convenience; storage may be unavailable in restricted webviews.
  }
}
