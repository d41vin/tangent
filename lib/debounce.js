/**
 * Returns a debounced version of `callback` with helpers for navigation and
 * cleanup paths that should persist pending work immediately.
 */
export function debounce(callback, delay = 500) {
  let timeoutId = null;
  let latestArgs = null;

  const invoke = async () => {
    const args = latestArgs;
    latestArgs = null;
    timeoutId = null;
    if (args) {
      return callback(...args);
    }
    return undefined;
  };

  function debounced(...args) {
    latestArgs = args;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(invoke, delay);
  }

  debounced.flush = async () => {
    if (!timeoutId) return undefined;
    clearTimeout(timeoutId);
    return invoke();
  };

  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    latestArgs = null;
  };

  return debounced;
}
