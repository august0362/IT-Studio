import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';

export const QWEN_DEFAULT_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const REGIONS = [
  { url: QWEN_DEFAULT_ENDPOINT, label: 'api.qwenInternational' },
  { url: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1', label: 'api.qwenUs' },
  { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: 'api.qwenChina' },
];

export function validQwenEndpoint(endpoint: string): boolean {
  try {
    return endpoint.length <= 300 && new URL(endpoint).protocol === 'https:';
  } catch {
    return false;
  }
}

export function QwenEndpoint({
  endpoint,
  onChange,
  disabled,
}: {
  readonly endpoint: string;
  readonly onChange: (url: string) => void;
  readonly disabled: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const [custom, setCustom] = useState(false);
  const isCustom = custom || !REGIONS.some((region) => region.url === endpoint);
  return (
    <div className="mb-3 grid gap-2">
      <label htmlFor="qwen-region">{t('api.qwenEndpoint')}</label>
      <select
        id="qwen-region"
        className="rounded border border-border bg-surface px-3 py-2"
        disabled={disabled}
        value={isCustom ? 'custom' : endpoint}
        onChange={(event) => {
          const value = event.target.value;
          setCustom(value === 'custom');
          if (value !== 'custom') onChange(value);
        }}
      >
        {REGIONS.map((region) => (
          <option key={region.url} value={region.url}>
            {t(region.label)}
          </option>
        ))}
        <option value="custom">{t('api.qwenCustom')}</option>
      </select>
      {isCustom ? (
        <>
          <label htmlFor="qwen-custom-url">{t('api.qwenCustomUrl')}</label>
          <input
            id="qwen-custom-url"
            className="rounded border border-border px-3 py-2"
            type="url"
            maxLength={300}
            disabled={disabled}
            value={endpoint}
            aria-invalid={!validQwenEndpoint(endpoint)}
            aria-describedby={!validQwenEndpoint(endpoint) ? 'qwen-endpoint-error' : undefined}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          {!validQwenEndpoint(endpoint) ? (
            <p id="qwen-endpoint-error" role="alert" className="text-sm text-danger">
              {t('api.qwenInvalid')}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
