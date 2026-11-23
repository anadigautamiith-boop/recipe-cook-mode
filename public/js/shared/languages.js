// The languages a recipe can be written in. Shared so the page's menu and the server's
// instructions to the AI can never drift apart.

// Name of each language, in English. This is what the AI is told to write in.
export const LANGUAGES = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese (Simplified)',
  ar: 'Arabic',
  id: 'Indonesian',
  same: 'the same language as the source',
};

// How each language names itself, for the menu.
export const LANGUAGE_MENU = [
  ['en', 'English'],
  ['hi', 'हिन्दी (Hindi)'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['pt', 'Português'],
  ['it', 'Italiano'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['zh', '中文 (简体)'],
  ['ar', 'العربية'],
  ['id', 'Bahasa Indonesia'],
  ['same', 'Same language as the video'],
];
