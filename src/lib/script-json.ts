/**
 * `JSON.stringify` for text that ends up inside an inline `<script>`. Plain
 * JSON can contain `</script>` or `<!--`, which the HTML parser acts on
 * before any JavaScript runs, and U+2028/U+2029, which older engines treat
 * as line breaks inside string literals. Escaping `<`, `>` and those two
 * characters as `\uXXXX` keeps the value identical once parsed.
 *
 * The escape text is built from the character code on purpose: written as
 * a literal escape, Biome's autofix turns it back into the raw character.
 */
const SCRIPT_UNSAFE = /[<>\u2028\u2029]/g;

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    SCRIPT_UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
