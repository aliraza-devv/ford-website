/**
 * three's GLTFLoader renames every node through `PropertyBinding.sanitizeNodeName`,
 * which STRIPS the characters `. [ ] : /` outright (it does not substitute
 * them). So this model's "GT500.Door.L_carpaint_0" is only ever reachable as
 * "GT500DoorL_carpaint_0" once loaded.
 *
 * Everything that matches on node names matches on the NORMALISED form, and the
 * names written out in the code stay as they appear in the actual asset, which
 * is what you would search for in a viewer.
 */
export function normalizeNodeName(name: string): string {
  return name.replace(/[.[\]:/]/g, "");
}
