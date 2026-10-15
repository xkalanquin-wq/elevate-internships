// Escaping for text placed in server-built HTML: page bodies, attributes and
// emails. One copy, so every page escapes the same four characters the same way.

/** `<`, `>`, `&` and `"` as entities; null and undefined become ''. */
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
