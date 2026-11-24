import { harnessPuzzle } from './puzzle';

declare const __HARNESS_DATE__: string;

export const context = {
  postId: 't3_harness',
  postData: harnessPuzzle(__HARNESS_DATE__).post,
};

export const requestExpandedMode = (...args: unknown[]) => console.log('requestExpandedMode', ...args);
export const exitExpandedMode = (...args: unknown[]) => console.log('exitExpandedMode', ...args);
export const navigateTo = (...args: unknown[]) => console.log('navigateTo', ...args);
export const showLoginPrompt = (...args: unknown[]) => console.log('showLoginPrompt', ...args);
export const showToast = (...args: unknown[]) => console.log('showToast', ...args);
