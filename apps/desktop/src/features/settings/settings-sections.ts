export const SETTINGS_SECTIONS = [
  {
    route: 'settings-api-keys',
    en: 'API keys',
    vi: 'Khóa API',
    keywords: 'key api provider token secret khóa nhà cung cấp',
  },
  {
    route: 'settings-router',
    en: 'Router',
    vi: 'Bộ định tuyến',
    keywords: 'fallback ladder model routing dự phòng mô hình',
  },
  {
    route: 'settings-pipeline',
    en: 'Pipeline',
    vi: 'Quy trình',
    keywords: 'roles agent clarify commands worker quy trình vai trò lệnh',
  },
  {
    route: 'settings-orchestration',
    en: 'Orchestration',
    vi: 'Điều phối',
    keywords: 'agents supervisor workers reviewer retries orchestration điều phối',
  },
  {
    route: 'settings-budget',
    en: 'Budget',
    vi: 'Ngân sách',
    keywords: 'budget limit hard stop spending ngân sách giới hạn',
  },
  { route: 'settings-pricing', en: 'Pricing', vi: 'Giá', keywords: 'prices cost update override giá chi phí' },
  {
    route: 'settings-fx',
    en: 'Currency (FX)',
    vi: 'Tiền tệ (FX)',
    keywords: 'currency fx exchange rate usd vnd tiền tệ tỷ giá',
  },
  { route: 'settings-images', en: 'Images', vi: 'Hình ảnh', keywords: 'image generation flux dall-e hình ảnh tạo ảnh' },
  {
    route: 'settings-web-chat',
    en: 'Web chat',
    vi: 'Trò chuyện web',
    keywords:
      'browser coccoc links panes web chat deepseek qwen le chat mistral microsoft copilot kimi meta ai poe huggingchat huggingface z.ai glm trình duyệt',
  },
  {
    route: 'settings-vscode',
    en: 'VS Code',
    vi: 'VS Code',
    keywords: 'editor extension launch code trình soạn thảo tiện ích',
  },
  {
    route: 'settings-theme',
    en: 'Appearance & language',
    vi: 'Giao diện & ngôn ngữ',
    keywords: 'appearance theme dark light language locale giao diện tối sáng ngôn ngữ',
  },
  { route: 'settings-labs', en: 'Labs', vi: 'Thử nghiệm', keywords: 'labs experimental pipeline studio thử nghiệm' },
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

export interface SettingSearchEntry {
  readonly section: SettingsSectionRoute;
  readonly id: string;
  readonly en: string;
  readonly vi: string;
  readonly keywords: string;
}
/** Stable targets for all visible settings, including settings represented by lists. */
export const SETTINGS_FIELDS: readonly SettingSearchEntry[] = [
  {
    section: 'settings-orchestration',
    id: 'orch-supervisor',
    en: 'Orchestration supervisor agent',
    vi: 'Tác nhân giám sát điều phối',
    keywords: 'agent model transport supervisor orchestration',
  },
  {
    section: 'settings-orchestration',
    id: 'orch-worker-a',
    en: 'Orchestration worker A model',
    vi: 'Mô hình nhân viên điều phối A',
    keywords: 'worker agent model',
  },
  {
    section: 'settings-orchestration',
    id: 'orch-worker-b',
    en: 'Orchestration worker B model',
    vi: 'Mô hình nhân viên điều phối B',
    keywords: 'worker agent model',
  },
  {
    section: 'settings-orchestration',
    id: 'orch-reviewer',
    en: 'Orchestration reviewer agent',
    vi: 'Tác nhân đánh giá điều phối',
    keywords: 'reviewer agent model',
  },
  {
    section: 'settings-orchestration',
    id: 'orch-limits',
    en: 'Orchestration budget and limits',
    vi: 'Ngân sách và giới hạn điều phối',
    keywords: 'maximum cost wall clock calls workers fix retries hard stop',
  },
  {
    section: 'settings-pipeline',
    id: 'pipeline-auto-clarify',
    en: 'Auto-answer clarifying questions with the recommendation',
    vi: 'Tự động trả lời câu hỏi làm rõ bằng đề xuất',
    keywords: 'auto answer clarifying questions recommended',
  },
  {
    section: 'settings-pipeline',
    id: 'pipeline-pm',
    en: 'PM model order',
    vi: 'Thứ tự mô hình PM',
    keywords: 'model ladder priority',
  },
  {
    section: 'settings-pipeline',
    id: 'pipeline-coder',
    en: 'Coder model order',
    vi: 'Thứ tự mô hình lập trình',
    keywords: 'code model ladder',
  },
  {
    section: 'settings-pipeline',
    id: 'pipeline-reviewer',
    en: 'Reviewer model order',
    vi: 'Thứ tự mô hình đánh giá',
    keywords: 'model ladder review',
  },
  {
    section: 'settings-pipeline',
    id: 'pipeline-validation',
    en: 'Validation commands',
    vi: 'Lệnh kiểm tra',
    keywords: 'build lint test commands',
  },
  {
    section: 'settings-pipeline',
    id: 'pipeline-max-fix',
    en: 'Maximum fix attempts (1)',
    vi: 'Số lần sửa tối đa (1)',
    keywords: 'retry fix',
  },
  {
    section: 'settings-router',
    id: 'router-auto-fallback',
    en: 'Auto Fallback',
    vi: 'Tự động chuyển dự phòng',
    keywords: 'automatic fallback',
  },
  {
    section: 'settings-router',
    id: 'router-lock-model',
    en: 'Lock model',
    vi: 'Khóa mô hình',
    keywords: 'preferred model',
  },
  {
    section: 'settings-router',
    id: 'router-timeout',
    en: 'Decision timeout (seconds)',
    vi: 'Thời gian chờ quyết định (giây)',
    keywords: 'decision seconds',
  },
  {
    section: 'settings-router',
    id: 'router-ladder',
    en: 'Model ladder',
    vi: 'Thứ tự mô hình',
    keywords: 'enabled models order priority',
  },
  {
    section: 'settings-router',
    id: 'router-model-enabled',
    en: 'Model enabled',
    vi: 'Bật mô hình',
    keywords: 'enable disable model ladder bật tắt mô hình',
  },
  {
    section: 'settings-budget',
    id: 'budget-hard-stop',
    en: 'Hard Stop',
    vi: 'Dừng cứng',
    keywords: 'spending limit ngân sách',
  },
  {
    section: 'settings-pricing',
    id: 'pricing-extraction-model',
    en: 'Model for price extraction',
    vi: 'Mô hình trích xuất giá',
    keywords: 'prices model',
  },
  {
    section: 'settings-pricing',
    id: 'pricing-update',
    en: 'Update prices',
    vi: 'Cập nhật giá',
    keywords: 'fetch price',
  },
  {
    section: 'settings-pricing',
    id: 'pricing-overrides',
    en: 'Override',
    vi: 'Ghi đè',
    keywords: 'manual input output cached price',
  },
  {
    section: 'settings-fx',
    id: 'fx-override',
    en: 'VND per USD',
    vi: 'VND mỗi USD',
    keywords: 'exchange rate usd vnd tỷ giá',
  },
  {
    section: 'settings-fx',
    id: 'fx-clear',
    en: 'Clear override',
    vi: 'Xóa ghi đè',
    keywords: 'automatic exchange rate',
  },
  {
    section: 'settings-images',
    id: 'images-enabled',
    en: 'Enable image generation',
    vi: 'Bật tính năng tạo hình ảnh',
    keywords: 'image generation',
  },
  {
    section: 'settings-images',
    id: 'images-provider-order',
    en: 'Provider order',
    vi: 'Thứ tự nhà cung cấp',
    keywords: 'image fallback priority',
  },
  {
    section: 'settings-web-chat',
    id: 'webchat-browser',
    en: 'Browser',
    vi: 'Trình duyệt',
    keywords: 'coccoc default browser',
  },
  {
    section: 'settings-web-chat',
    id: 'webchat-custom-path',
    en: 'Browser .exe path',
    vi: 'Đường dẫn tệp .exe của trình duyệt',
    keywords: 'custom browser executable',
  },
  {
    section: 'settings-web-chat',
    id: 'webchat-links',
    en: 'Web chat links and order',
    vi: 'Liên kết trò chuyện web và thứ tự',
    keywords: 'links url enabled order web chat sites',
  },
  {
    section: 'settings-web-chat',
    id: 'webchat-link-name',
    en: 'Name',
    vi: 'Tên',
    keywords: 'web chat link name',
  },
  {
    section: 'settings-web-chat',
    id: 'webchat-link-url',
    en: 'URL',
    vi: 'URL',
    keywords: 'web chat link address địa chỉ liên kết',
  },
  {
    section: 'settings-web-chat',
    id: 'webchat-link-enabled',
    en: 'Enabled',
    vi: 'Bật',
    keywords: 'web chat link enabled show hiện liên kết',
  },
  {
    section: 'settings-vscode',
    id: 'vscode-auto-launch',
    en: 'Launch VS Code automatically',
    vi: 'Tự động mở VS Code',
    keywords: 'editor automatic',
  },
  {
    section: 'settings-vscode',
    id: 'vscode-executable',
    en: 'code executable path (blank = auto-detect)',
    vi: 'Đường dẫn thực thi code (để trống = tự tìm)',
    keywords: 'editor path',
  },
  {
    section: 'settings-vscode',
    id: 'vscode-show-diff',
    en: 'Show diff before validation',
    vi: 'Hiện khác biệt trước khi kiểm tra',
    keywords: 'validation compare',
  },
  {
    section: 'settings-vscode',
    id: 'vscode-reveal',
    en: 'Reveal changed files',
    vi: 'Hiện tệp đã thay đổi',
    keywords: 'changed files',
  },
  {
    section: 'settings-theme',
    id: 'theme-language',
    en: 'Language',
    vi: 'Ngôn ngữ',
    keywords: 'locale english vietnamese ngôn ngữ',
  },
  {
    section: 'settings-theme',
    id: 'theme-mode',
    en: 'Theme mode (System, Light, Dark)',
    vi: 'Chế độ giao diện (Hệ thống, Sáng, Tối)',
    keywords: 'dark light mode appearance',
  },
  {
    section: 'settings-theme',
    id: 'theme-primary',
    en: 'Primary theme',
    vi: 'Chủ đề chính',
    keywords: 'primary theme appearance palette giao diện chủ đề',
  },
  {
    section: 'settings-labs',
    id: 'labs-pipeline-studio',
    en: 'Show Pipeline Studio',
    vi: 'Hiển thị Pipeline Studio',
    keywords: 'pipeline studio experimental',
  },
  {
    section: 'settings-api-keys',
    id: 'qwen-region',
    en: 'Region / endpoint',
    vi: 'Khu vực / điểm cuối',
    keywords: 'region endpoint',
  },
  {
    section: 'settings-api-keys',
    id: 'qwen-custom-url',
    en: 'Custom HTTPS endpoint',
    vi: 'Điểm cuối HTTPS tùy chỉnh',
    keywords: 'custom base url https',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-anthropic',
    en: 'anthropic API key',
    vi: 'Khóa API anthropic',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-openai',
    en: 'openai API key',
    vi: 'Khóa API openai',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-google',
    en: 'google API key',
    vi: 'Khóa API google',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-xai',
    en: 'xai API key',
    vi: 'Khóa API xai',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-groq',
    en: 'groq API key',
    vi: 'Khóa API groq',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-together',
    en: 'together API key',
    vi: 'Khóa API together',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-deepseek',
    en: 'deepseek API key',
    vi: 'Khóa API deepseek',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-openrouter',
    en: 'openrouter API key',
    vi: 'Khóa API openrouter',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-qwen',
    en: 'qwen API key',
    vi: 'Khóa API qwen',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-mistral',
    en: 'mistral API key',
    vi: 'Khóa API mistral',
    keywords: 'provider secret token nhà cung cấp',
  },
  {
    section: 'settings-api-keys',
    id: 'api-key-replicate',
    en: 'replicate API key',
    vi: 'Khóa API replicate',
    keywords: 'provider secret token nhà cung cấp',
  },
];
export interface SettingSuggestion {
  readonly section: SettingsSectionRoute;
  readonly id?: string;
  readonly en: string;
  readonly vi: string;
  readonly keywords: string;
}
export function normalizeSettingsText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\u0111/gu, 'd')
    .replace(/\u0110/gu, 'D')
    .toLocaleLowerCase();
}
export function searchSettings(text: string): readonly SettingSuggestion[] {
  const query = normalizeSettingsText(text.trim());
  if (!query) return [];
  const entries: readonly SettingSuggestion[] = [
    ...SETTINGS_SECTIONS.map((section) => ({ ...section, section: section.route })),
    ...SETTINGS_FIELDS,
  ];
  return entries
    .map((entry, order) => {
      const section = SETTINGS_SECTIONS.find((item) => item.route === entry.section);
      const labels = [entry.en, entry.vi].map(normalizeSettingsText);
      const values = [
        ...labels,
        normalizeSettingsText(entry.keywords),
        normalizeSettingsText((section?.en ?? '') + ' ' + (section?.vi ?? '')),
      ];
      const rank = labels.some((label) => label.startsWith(query))
        ? 0
        : entry.id !== undefined &&
            [section?.en ?? '', section?.vi ?? ''].some((label) => normalizeSettingsText(label).startsWith(query))
          ? 0.5
          : values.some((value) => value.split(/\s+/u).some((word) => word.startsWith(query)))
            ? 1
            : 2;
      return { entry, order, rank, matches: values.some((value) => value.includes(query)) };
    })
    .filter((item) => item.matches)
    .sort(
      (a, b) =>
        a.rank - b.rank || Number(a.entry.id !== undefined) - Number(b.entry.id !== undefined) || a.order - b.order,
    )
    .slice(0, 8)
    .map((item) => item.entry);
}
