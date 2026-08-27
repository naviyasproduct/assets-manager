/**
 * Small hand-offs between two screens, carried in sessionStorage.
 *
 * Two of them: the add-asset form surviving a trip to the create-a-department
 * page and coming back with everything still typed in, and a set of assets
 * ticked on the Assets screen arriving at the report builder.
 *
 * sessionStorage rather than the URL: a half-filled asset has no business being
 * in a link someone can paste, a list of two hundred asset ids does not belong
 * in one either, and neither should outlive the tab. Every read is
 * a take - a restored draft is consumed, so it can never reappear later on an
 * unrelated visit to the same page.
 */

export const ASSET_DRAFT_KEY = 'am:asset-form-draft';
/** Assets ticked on the Assets screen, on their way to the report builder. */
export const ASSET_SELECTION_KEY = 'am:report-asset-selection';
export const NEW_DEPARTMENT_KEY = 'am:new-department';

export function stashDraft(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-mode quota failures are not worth blocking navigation over.
  }
}

export function takeDraft<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;

  const raw = window.sessionStorage.getItem(key);
  if (raw === null) return null;
  window.sessionStorage.removeItem(key);

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
