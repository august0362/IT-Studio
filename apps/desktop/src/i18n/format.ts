export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(resolveLocale(locale), options).format(value);
}

export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(resolveLocale(locale), { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(resolveLocale(locale), { dateStyle: 'short' }).format(new Date(iso));
}

function resolveLocale(locale: string): string {
  return locale.toLowerCase().startsWith('vi') ? 'vi-VN' : 'en-US';
}
