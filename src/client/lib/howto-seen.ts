const SEEN_KEY = 'foldline:howto-seen';

export function hasSeenHowTo(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markHowToSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage can be blocked; the card then shows on every visit */
  }
}
