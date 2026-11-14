/**
 * Owner time rules are cached for five minutes, but a window-focus return must
 * still refresh them: the cached booking window may be a day old near midnight.
 */
export const configQueryOptions = {
  query: {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: "always" as const,
  },
};
