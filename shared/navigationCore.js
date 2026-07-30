const parseHttpUrl = (url) => {
  try {
    const parsed = new URL(String(url || ""));
    return /^https?:$/i.test(parsed.protocol) ? parsed : null;
  } catch (_error) {
    return null;
  }
};

const isTelegramWebUrl = (parsed) =>
  /(^|\.)web\.telegram\.org$/i.test(String(parsed?.hostname || ""));

const documentRouteKey = (parsed) =>
  `${parsed.origin}${parsed.pathname}${parsed.search}`;

export const shouldResetForUrlOnlyNavigation = (previousUrl, nextUrl) => {
  const next = parseHttpUrl(nextUrl === undefined ? previousUrl : nextUrl);
  if (!next) return false;

  const previous = nextUrl === undefined ? null : parseHttpUrl(previousUrl);
  if (!previous) {
    if (!next.hash) return true;
    return isTelegramWebUrl(next);
  }

  if (documentRouteKey(previous) !== documentRouteKey(next)) {
    return true;
  }

  if (isTelegramWebUrl(next) && previous.hash !== next.hash) {
    return true;
  }

  return false;
};
