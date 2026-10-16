export const SETTINGS_SECTIONS = [
  { route: 'settings-api-keys', keywords: 'key api provider token secret khóa nhà cung cấp' },
  { route: 'settings-router', keywords: 'fallback ladder model routing dự phòng mô hình' },
  { route: 'settings-pipeline', keywords: 'roles agent clarify commands worker quy trình vai trò lệnh' },
  { route: 'settings-budget', keywords: 'budget limit hard stop spending ngân sách giới hạn' },
  { route: 'settings-pricing', keywords: 'prices cost update override giá chi phí' },
  { route: 'settings-fx', keywords: 'currency fx exchange rate usd vnd tiền tệ tỷ giá' },
  { route: 'settings-images', keywords: 'image generation flux dall-e hình ảnh tạo ảnh' },
  {
    route: 'settings-web-chat',
    keywords:
      'browser coccoc links panes web chat deepseek qwen le chat mistral microsoft copilot kimi meta ai poe huggingchat huggingface z.ai glm trình duyệt',
  },
  { route: 'settings-vscode', keywords: 'editor extension launch code trình soạn thảo tiện ích' },
  { route: 'settings-theme', keywords: 'appearance theme dark light language locale giao diện tối sáng ngôn ngữ' },
  { route: 'settings-labs', keywords: 'labs experimental pipeline studio thử nghiệm' },
] as const;

export type SettingsSectionRoute = (typeof SETTINGS_SECTIONS)[number]['route'];

export function isSettingsSectionRoute(value: string): value is SettingsSectionRoute {
  return SETTINGS_SECTIONS.some(({ route }) => route === value);
}

export function readLastSettingsRoute(): SettingsSectionRoute {
  try {
    const value = localStorage.getItem('itstudio.settingsSection');
    if (value !== null && isSettingsSectionRoute(value)) return value;
  } catch {
    // Section persistence is optional in restricted webviews.
  }
  return 'settings-api-keys';
}

export function rememberSettingsRoute(route: SettingsSectionRoute): void {
  try {
    localStorage.setItem('itstudio.settingsSection', route);
  } catch {
    // Navigation still works when storage is unavailable.
  }
}
